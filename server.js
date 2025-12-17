require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { ObjectId } = mongoose.Types;

const app = express();
const PORT = process.env.PORT || 5000; 

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'helper-profiles',
        allowed_formats: ['jpg', 'png', 'jpeg'],
        transformation: [{ width: 500, height: 500, crop: 'limit' }]
    },
});
const upload = multer({ storage: storage });

const allowedOrigins = [
    'http://localhost:3000',
    'https://backend-minor-project.onrender.com'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1 && origin.indexOf('localhost') === -1) {
            return callback(null, true);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/silverconnect"; 

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ MongoDB Error:", err));

const UserSchema = new mongoose.Schema({
    fullName: String,
    email: { type: String, unique: true },
    password: { type: String },
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

const recalculateHelperRating = async (helperId) => {
    try {
        const reviews = await Review.find({ helperId });
        if (reviews.length > 0) {
            const avgRating = reviews.reduce((acc, curr) => acc + curr.rating, 0) / reviews.length;
            await Helper.findOneAndUpdate({ _id: helperId }, {
                rating: parseFloat(avgRating.toFixed(1)),
                reviews: reviews.length
            });
        } else {
            await Helper.findOneAndUpdate({ _id: helperId }, { rating: 5.0, reviews: 0 });
        }
    } catch (err) { console.error("Rating Recalc Error:", err); }
};

app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, password, role } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "Email already exists" });
        const image = `https://i.pravatar.cc/150?u=${encodeURIComponent(fullName)}`;
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

app.post('/api/google-login', async (req, res) => {
    try {
        const { email, name, image } = req.body;
        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ fullName: name, email, image, role: 'user' });
            await user.save();
        }
        res.json({ message: "Google Auth Success", user });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users', async (req, res) => {
    try { res.json(await User.find({}, '-password')); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/:email', async (req, res) => {
    try {
        await User.findOneAndDelete({ email: req.params.email });
        await Helper.findOneAndDelete({ email: req.params.email });
        res.json({ message: "User deleted" });
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
                    id: count + 1, email: updatedUser.email, name: updatedUser.fullName,
                    role: 'Unassigned Service', price: '$20/hr', status: 'Approved',
                    image: updatedUser.image, bio: 'Promoted by admin.', experience: '1 Year',
                    location: 'Global', description: 'Available for care services.'
                });
                await newHelper.save();
            }
        }
        res.json({ message: `Role updated`, user: updatedUser });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/helpers', async (req, res) => {
    try { res.json(await Helper.find({ status: 'Approved' })); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/helpers', async (req, res) => {
    try { res.json(await Helper.find()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/helpers/:id', async (req, res) => {
    try {
        const queryId = parseInt(req.params.id);
        const helper = await Helper.findOne({ id: queryId });
        if (helper) res.json(helper); 
        else res.status(404).json({ message: "Helper profile not found." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/helper-profile/:email', async (req, res) => {
    try {
        const helper = await Helper.findOne({ email: req.params.email });
        if (helper) res.json(helper);
        else res.status(404).json({ message: "Helper profile not found." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/helpers', async (req, res) => {
    try {
        const count = await Helper.countDocuments();
        const newHelper = new Helper({ ...req.body, id: count + 1, status: 'Pending' });
        await newHelper.save();
        res.json(newHelper);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/helpers/:id', async (req, res) => {
    try {
        const updated = await Helper.findOneAndUpdate({ id: parseInt(req.params.id) }, { $set: req.body }, { new: true });
        res.json(updated);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/helper-profile/:email', upload.single('image'), async (req, res) => {
    try {
        const email = req.params.email;
        const updateData = { ...req.body };
        
        if (req.file) {
            updateData.image = req.file.path; 
        }

        const userUpdatePayload = {
            fullName: updateData.name || updateData.fullName,
            phone: updateData.phone,
            address: updateData.location || updateData.address,
            bio: updateData.bio
        };
        if (updateData.image) userUpdatePayload.image = updateData.image;

        const updatedUser = await User.findOneAndUpdate(
            { email },
            { $set: userUpdatePayload },
            { new: true }
        );

        if (!updatedUser) return res.status(404).json({ message: "User not found" });

        const updatedHelper = await Helper.findOneAndUpdate(
            { email },
            { $set: updateData },
            { new: true }
        );

        res.json(updatedHelper || updatedUser);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/helpers/:id/approve', async (req, res) => {
    try {
        const h = await Helper.findOneAndUpdate({ id: parseInt(req.params.id) }, { status: 'Approved' }, { new: true });
        if (h) await User.findOneAndUpdate({ email: h.email }, { role: 'helper' });
        res.json(h);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/helpers/:id', async (req, res) => {
    try {
        const h = await Helper.findOneAndDelete({ id: parseInt(req.params.id) });
        if (h) await User.findOneAndUpdate({ email: h.email }, { role: 'user' });
        res.json({ message: "Helper removed" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/bookings', async (req, res) => {
    try { res.json(await Booking.find()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/bookings', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.userEmail });
        if (!user) return res.status(404).json({ message: "User not found." });
        const newBooking = new Booking({
            id: Date.now(), ...req.body, status: 'Pending'
        });
        await newBooking.save();
        res.json({ message: "Booking confirmed", status: "Pending" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/bookings/:id/approve', async (req, res) => {
    try {
        const updated = await Booking.findOneAndUpdate({ id: parseInt(req.params.id) }, { status: 'Confirmed' }, { new: true });
        res.json(updated);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/bookings/:id/cancel', async (req, res) => {
    try {
        const updated = await Booking.findOneAndUpdate({ id: parseInt(req.params.id) }, { status: 'Cancelled' }, { new: true });
        res.json(updated);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/reviews', async (req, res) => {
    try { res.json(await Review.find().sort({ timestamp: -1 })); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/reviews/helper/:helperObjectId', async (req, res) => {
    try {
        const reviews = await Review.find({ helperId: req.params.helperObjectId }).sort({ timestamp: -1 });
        res.json(reviews);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reviews', async (req, res) => {
    try {
        const reviewDocument = new Review({ ...req.body, bookingId: parseInt(req.body.bookingId) });
        await reviewDocument.save();
        await recalculateHelperRating(req.body.helperId);
        await Booking.updateOne({ id: parseInt(req.body.bookingId) }, { isReviewed: true });
        res.status(201).json({ message: 'Review submitted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/reviews/:id', async (req, res) => {
    try {
        const updated = await Review.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
        if (updated) await recalculateHelperRating(updated.helperId);
        res.json(updated);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/reviews/:id', async (req, res) => {
    try {
        const deleted = await Review.findByIdAndDelete(req.params.id);
        if (deleted) {
            await recalculateHelperRating(deleted.helperId);
            await Booking.updateOne({ id: deleted.bookingId }, { isReviewed: false });
            res.json({ message: "Review deleted" });
        } else res.status(404).json({ message: "Review not found" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contact', async (req, res) => {
    try { res.json(await Contact.find().sort({ date: -1 })); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contact', async (req, res) => {
    try {
        const msg = new Contact(req.body);
        await msg.save();
        res.json({ message: "Message received" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/contact/:id', async (req, res) => {
    try { await Contact.findByIdAndDelete(req.params.id); res.json({ message: "Deleted" }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));