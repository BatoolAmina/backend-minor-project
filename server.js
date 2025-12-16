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
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ MongoDB Error:", err));

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

        if (!user || user.password !== password) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        res.json({ 
            message: "Login successful", 
            user: { 
                id: user._id, name: user.fullName, email: user.email, role: user.role,
                image: user.image, phone: user.phone, address: user.address, bio: user.bio
            } 
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/google-login', async (req, res) => {
    try {
        const { email, name, image } = req.body;
        let user = await User.findOne({ email });
        
        if (!user) {
            user = new User({ fullName: name, email, image, role: 'user' });
            await user.save();
        } else {
             if (image && user.image !== image) {
                 user.image = image;
                 await user.save();
             }
        }
        res.json({ message: "Google Login Success", user: {
                 id: user._id, name: user.fullName, email: user.email, role: user.role,
                 image: user.image, phone: user.phone, address: user.address, bio: user.bio
        } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:email', async (req, res) => {
    try {
        const updatedUser = await User.findOneAndUpdate(
            { email: req.params.email }, 
            { $set: req.body },
            { new: true } 
        );
        if (updatedUser) {
            res.json({ 
                message: "Profile updated successfully", 
                user: {
                    name: updatedUser.fullName, email: updatedUser.email, role: updatedUser.role,
                    image: updatedUser.image, phone: updatedUser.phone, address: updatedUser.address, bio: updatedUser.bio
                }
            });
        } else { res.status(404).json({ message: "User not found" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/users/:email/role', async (req, res) => {
    try {
        const { newRole } = req.body;
        const email = req.params.email;

        const updatedUser = await User.findOneAndUpdate(
            { email },
            { $set: { role: newRole } },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found." });
        }

        if (newRole === 'user' || newRole === 'admin') {
            await Helper.findOneAndDelete({ email });
        }
        
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
                    bio: updatedUser.bio || 'Helper profile generated by Admin promotion.',
                    image: updatedUser.image || `https://i.pravatar.cc/150?u=${updatedUser.fullName}`,
                    description: 'Generic description, please update.',
                    status: 'Approved'
                });
                await newHelper.save();
            } else if (existingHelper.status === 'Pending') {
                existingHelper.status = 'Approved';
                await existingHelper.save();
            }
        }

        res.json({ 
            message: `Role updated to ${newRole} successfully.`,
            user: updatedUser
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/helpers', async (req, res) => {
    try { const helpers = await Helper.find({ status: 'Approved' }); res.json(helpers); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/helpers', async (req, res) => {
    try { const helpers = await Helper.find(); res.json(helpers); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/helpers/:id', async (req, res) => {
    try {
        const helper = await Helper.findOne({ id: parseInt(req.params.id) });
        if (helper) res.json(helper); else res.status(404).json({ message: "Not found" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/helpers', async (req, res) => {
    try {
        const count = await Helper.countDocuments();
        const newHelper = new Helper({
            ...req.body,
            id: count + 1,
            status: 'Pending',
            image: req.body.image || `https://i.pravatar.cc/150?u=${req.body.name}`
        });
        await newHelper.save();
        res.json(newHelper);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.put('/api/helpers/:id/approve', async (req, res) => {
    try {
        const updatedHelper = await Helper.findOneAndUpdate(
            { id: parseInt(req.params.id) },
            { status: 'Approved' },
            { new: true }
        );

        if (updatedHelper && updatedHelper.email) {
            await User.findOneAndUpdate(
                { email: updatedHelper.email },
                { role: 'helper' } 
            );
        }

        res.json(updatedHelper);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.put('/api/helpers/:id', async (req, res) => {
    try {
        const updatedHelper = await Helper.findOneAndUpdate(
            { id: parseInt(req.params.id) },
            { $set: req.body },
            { new: true }
        );
        if (updatedHelper) res.json(updatedHelper);
        else res.status(404).json({ message: "Helper not found" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/helpers/:id', async (req, res) => {
    try { 
        const deletedHelper = await Helper.findOneAndDelete({ id: parseInt(req.params.id) });
        
        if (deletedHelper && deletedHelper.email) {
            await User.findOneAndUpdate(
                { email: deletedHelper.email },
                { $set: { role: 'user' } }
            );
        }
        
        res.json({ message: "Helper and user role deleted/reverted." }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/api/helper-profile/:email', async (req, res) => {
    try {
        const helper = await Helper.findOne({ email: req.params.email });
        if (helper) res.json(helper);
        else res.status(404).json({ message: "Helper profile not found" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/helper-profile/:email', async (req, res) => {
    try {
        const updatedHelper = await Helper.findOneAndUpdate(
            { email: req.params.email },
            { $set: req.body },
            { new: true }
        );
        res.json(updatedHelper);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/bookings', async (req, res) => {
    try { const bookings = await Booking.find(); res.json(bookings); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/bookings/:id', async (req, res) => {
    try { 
        const booking = await Booking.findOne({ id: parseInt(req.params.id) }); 
        if (booking) res.json(booking);
        else res.status(404).json({ message: "Booking not found" });
    } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/bookings', async (req, res) => {
    try {
        const { userEmail, helperName, date, startTime, endTime, address, phone, notes, helperId, helperEmail } = req.body;

        const user = await User.findOne({ email: userEmail });
        if (!user) {
            return res.status(404).json({ message: "Booking user not found." });
        }

        if (helperEmail === userEmail) {
            return res.status(400).json({ message: "You cannot book yourself." });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const bookingDate = new Date(date);

        if (bookingDate < today) {
             return res.status(400).json({ message: "You cannot book a date in the past." });
        }

        const newBooking = new Booking({
            id: Date.now(),
            userEmail,
            userName: user.fullName,
            helperName,
            helperId,
            helperEmail,
            date,
            startTime,
            endTime,
            address,
            phone,
            notes,
            status: 'Pending'
        });

        await newBooking.save();
        
        res.json({ message: "Booking confirmed", status: "confirmed" });
    } catch (err) {
        console.error("Error creating booking:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/bookings/:id/approve', async (req, res) => {
    try {
        const updatedBooking = await Booking.findOneAndUpdate(
            { id: parseInt(req.params.id) },
            { status: 'Confirmed' },
            { new: true }
        );
        
        res.json(updatedBooking);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/bookings/:id/reject', async (req, res) => {
    try {
        const updatedBooking = await Booking.findOneAndUpdate(
            { id: parseInt(req.params.id) },
            { status: 'Rejected' },
            { new: true }
        );
        
        res.json(updatedBooking);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/bookings/:id/cancel', async (req, res) => {
    try {
        const updatedBooking = await Booking.findOneAndUpdate(
            { id: parseInt(req.params.id) },
            { status: 'Cancelled' },
            { new: true }
        );
        
        res.json(updatedBooking);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/bookings/:id', async (req, res) => {
    try { await Booking.findOneAndDelete({ id: parseInt(req.params.id) }); res.json({ message: "Booking deleted" }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reviews', async (req, res) => {
    try {
        const data = req.body;
        const required_fields = ['helperId', 'rating', 'reviewText', 'bookingId', 'reviewerName'];
        
        if (!all(required_fields, field => field in data)) {
            return res.status(400).json({ message: 'Missing required review fields' });
        }

        const rating = parseInt(data.rating);
        if (isNaN(rating) || rating < 1 || rating > 5) {
             return res.status(400).json({ message: 'Rating must be an integer between 1 and 5' });
        }
        
        if (!ObjectId.isValid(data.helperId)) {
            return res.status(400).json({ message: "Invalid Helper ID format." });
        }
        const helper_objectId = new ObjectId(data.helperId);
        
        const bookingIdInt = parseInt(data.bookingId);
        const existingBooking = await Booking.findOne({ id: bookingIdInt });

        if (!existingBooking) {
            return res.status(404).json({ message: "Booking not found." });
        }
        if (existingBooking.isReviewed) {
            return res.status(400).json({ message: "This booking has already been reviewed." });
        }
        if (existingBooking.status !== 'Confirmed') {
             return res.status(400).json({ message: "Booking must be Confirmed to be reviewed." });
        }

        const reviewDocument = new Review({
            helperId: data.helperId,
            bookingId: bookingIdInt,
            reviewerName: data.reviewerName,
            rating: rating,
            reviewText: data.reviewText,
        });
        await reviewDocument.save();
        
        const reviewStats = await Review.aggregate([
            { '$match': { 'helperId': data.helperId } },
            {
                '$group': {
                    '_id': '$helperId',
                    'totalRating': { '$sum': '$rating' },
                    'count': { '$sum': 1 }
                }
            }
        ]);
        
        if (reviewStats.length > 0) {
            const stats = reviewStats[0];
            const new_average_rating = stats.totalRating / stats.count;
            
            await Helper.updateOne(
                { '_id': helper_objectId },
                {
                    '$set': {
                        'rating': parseFloat(new_average_rating.toFixed(1)),
                        'reviews': stats.count
                    }
                }
            );
        }

        await Booking.updateOne(
            { id: bookingIdInt },
            { '$set': { 'isReviewed': true } }
        );

        res.status(201).json({ message: 'Review submitted successfully' });

    } catch (err) {
        console.error("Error submitting review:", err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/api/reviews/helper/:helperId', async (req, res) => {
    try {
        const helperId = req.params.helperId;
        
        if (!ObjectId.isValid(helperId)) { 
            return res.status(400).json({ message: "Invalid Helper ID format." });
        }
        
        const reviews = await Review.find({ helperId: helperId })
            .sort({ timestamp: -1 });

        res.json(reviews);

    } catch (err) {
        console.error("Error fetching helper reviews:", err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.delete('/api/users/:email', async (req, res) => {
    try {
        const deletedUser = await User.findOneAndDelete({ email: req.params.email });
        if (deletedUser) res.json({ message: "Account deleted successfully" });
        else res.status(404).json({ message: "User not found" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contact', async (req, res) => {
    try { const m = new Contact(req.body); await m.save(); res.json({ message: "Message received successfully!" }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contact', async (req, res) => {
    try { const m = await Contact.find().sort({ date: -1 }); res.json(m); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/contact/:id', async (req, res) => {
    try { await Contact.findByIdAndDelete(req.params.id); res.json({ message: "Message deleted" }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users', async (req, res) => {
    try { const users = await User.find({}, '-password'); res.json(users); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

const seedHelpers = async () => {
    const count = await Helper.countDocuments();
    if (count === 0) {
        await Helper.create([
            { id: 1, email: "sarah@test.com", name: "Sarah Jenkins", role: "Medical Assistant", price: "$25/hr", image: "https://i.pravatar.cc/150?img=5", description: "Certified nurse with 5 years experience.", status: 'Approved' },
            { id: 2, email: "robert@test.com", name: "Robert Fox", role: "Companion", price: "$18/hr", image: "https://i.pravatar.cc/150?img=11", description: "Friendly companion.", status: 'Approved' }
        ]);
        console.log("🌱 Seeded initial helpers");
    }
};
seedHelpers();

const all = (arr, fn = Boolean) => arr.every(fn);

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
