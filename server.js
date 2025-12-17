require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;
const app = express();
const PORT = process.env.PORT || 5000; 

app.use(cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/silverconnect"; 

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Connected to Local MongoDB"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- Schemas ---
const UserSchema = new mongoose.Schema({
    fullName: String,
    email: { type: String, unique: true },
    password: String,
    role: { type: String, default: 'user' },
    image: String,
    phone: String,
    address: String,
    bio: String
});
const User = mongoose.model('User', UserSchema);

const HelperSchema = new mongoose.Schema({
    id: Number,
    email: String,
    name: String,
    role: String,
    image: String,
    description: String,
    price: String,
    location: String,
    reviews: { type: Number, default: 0 },
    rating: { type: Number, default: 5.0 },
    experience: String,
    bio: String,
    status: { type: String, default: 'Pending' }
});
const Helper = mongoose.model('Helper', HelperSchema);

const BookingSchema = new mongoose.Schema({
    id: Number,
    userEmail: String,
    userName: String,
    helperName: String,
    helperId: String,
    helperEmail: String,
    date: String,
    startTime: String,
    endTime: String,
    address: String,
    phone: String,
    notes: String,
    status: { type: String, default: 'Pending' },
    isReviewed: { type: Boolean, default: false }
});
const Booking = mongoose.model('Booking', BookingSchema);

const ReviewSchema = new mongoose.Schema({
    helperId: { type: String, required: true },
    bookingId: { type: Number, required: true, unique: true },
    reviewerName: String,
    rating: { type: Number, min: 1, max: 5 },
    reviewText: String,
    timestamp: { type: Date, default: Date.now }
});
const Review = mongoose.model('Review', ReviewSchema);

const ContactSchema = new mongoose.Schema({
    name: String,
    email: String,
    subject: String,
    message: String,
    date: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', ContactSchema);

// --- Utility Functions ---
const recalculateHelperRating = async (helperId) => {
    try {
        const reviews = await Review.find({ helperId });
        if (reviews.length > 0) {
            const avgRating = reviews.reduce((acc, curr) => acc + curr.rating, 0) / reviews.length;
            await Helper.findByIdAndUpdate(helperId, {
                rating: parseFloat(avgRating.toFixed(1)),
                reviews: reviews.length
            });
        } else {
            await Helper.findByIdAndUpdate(helperId, { rating: 5.0, reviews: 0 });
        }
    } catch (err) { console.error("Rating Recalc Error:", err); }
};

const all = (arr, fn = Boolean) => arr.every(fn);

// --- Routes ---

app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, password, role } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "Email already exists" });
        const image = `https://i.pravatar.cc/150?u=${fullName}`;
        const newUser = new User({ fullName, email, password, role, image });
        await newUser.save();
        res.json({ message: "Registration successful!", user: newUser });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || user.password !== password) return res.status(401).json({ message: "Invalid credentials" });
        res.json({ message: "Login successful", user });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/users/:email/role', async (req, res) => {
    try {
        const { newRole } = req.body;
        const email = req.params.email;
        const updatedUser = await User.findOneAndUpdate({ email }, { $set: { role: newRole } }, { new: true });
        if (!updatedUser) return res.status(404).json({ message: "User not found." });

        if (newRole !== 'helper') await Helper.findOneAndDelete({ email });
        
        if (newRole === 'helper') {
            let existingHelper = await Helper.findOne({ email });
            if (!existingHelper) {
                const count = await Helper.countDocuments();
                const newHelper = new Helper({
                    id: count + 1,
                    email: updatedUser.email,
                    name: updatedUser.fullName,
                    role: 'Unassigned Service',
                    price: '$20/hr',
                    location: updatedUser.address || 'Global',
                    experience: '1 Year',
                    bio: updatedUser.bio || 'Promoted by admin.',
                    image: updatedUser.image,
                    description: 'New helper profile.',
                    status: 'Approved'
                });
                await newHelper.save();
            } else {
                existingHelper.status = 'Approved';
                await existingHelper.save();
            }
        }
        res.json({ message: `Role updated to ${newRole}`, user: updatedUser });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/helpers/:id/approve', async (req, res) => {
    try {
        const updatedHelper = await Helper.findOneAndUpdate(
            { id: parseInt(req.params.id) },
            { status: 'Approved' },
            { new: true }
        );
        if (updatedHelper && updatedHelper.email) {
            await User.findOneAndUpdate({ email: updatedHelper.email }, { role: 'helper' });
            res.json(updatedHelper);
        } else {
            res.status(404).json({ message: "Helper not found" });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/helpers/:id', async (req, res) => {
    try {
        const deletedHelper = await Helper.findOneAndDelete({ id: parseInt(req.params.id) });
        if (deletedHelper && deletedHelper.email) {
            await User.findOneAndUpdate({ email: deletedHelper.email }, { role: 'user' });
        }
        res.json({ message: "Helper profile removed" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/bookings', async (req, res) => {
    try {
        const { userEmail, helperName, date, startTime, endTime, address, phone, notes, helperId, helperEmail } = req.body;
        const user = await User.findOne({ email: userEmail });
        if (!user) return res.status(404).json({ message: "User not found." });

        const newBooking = new Booking({
            id: Date.now(), userEmail, userName: user.fullName, helperName, helperId, helperEmail,
            date, startTime, endTime, address, phone, notes, status: 'Pending'
        });
        await newBooking.save();
        res.json({ message: "Booking pending approval", status: "Pending" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users', async (req, res) => {
    try { res.json(await User.find({}, '-password')); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/helpers', async (req, res) => {
    try { res.json(await Helper.find()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT} (Email disabled)`));