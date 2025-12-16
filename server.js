const nodemailer = require('nodemailer');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;
const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');
const app = express();
const PORT = process.env.PORT || 5000; 

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

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
    bio: String,
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false }
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

const OTPSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    otp: { type: String, required: true },
    type: { type: String, enum: ['email', 'phone'], required: true },
    createdAt: { type: Date, default: Date.now, expires: 300 }
});
const OTP = mongoose.model('OTP', OTPSchema);

const uploadStream = (req, folderName) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: folderName, public_id: req.params.email + '_' + Date.now() },
            (error, result) => {
                if (result) {
                    resolve(result);
                } else {
                    reject(error);
                }
            }
        );
        streamifier.createReadStream(req.file.buffer).pipe(stream);
    });
};

const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const sendVerificationCode = async (contact, otp, type) => {
    if (type === 'email') {
        // --- OPTIMIZED EMAIL CONFIGURATION (Port 587) ---
        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587, 
            secure: false, // Set to false for port 587
            requireTLS: true, // Force TLS for secure transmission
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: contact,
            subject: 'SilverConnect Verification Code',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                    <h2>SilverConnect Email Verification</h2>
                    <p>Your One-Time Password (OTP) is:</p>
                    <p style="font-size: 24px; font-weight: bold; color: #1a202c; background-color: #f7fafc; padding: 10px; border-radius: 4px; display: inline-block;">
                        ${otp}
                    </p>
                    <p>This code is valid for 5 minutes. Use it to verify your account.</p>
                </div>
            `,
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log(`Email verification code sent to ${contact}`);
            return true;
        } catch (error) {
            console.error('Nodemailer Error:', error);
            throw new Error('Failed to send verification email. Check server connection or App Password.');
        }
    } else if (type === 'phone') {
        // --- FREE/LOGGING METHOD FOR PHONE OTP ---
        console.warn('--- PHONE OTP SIMULATION ---');
        console.log(`[ACTION REQUIRED] Phone OTP for ${contact} is: ${otp}`);
        console.warn('The user must manually enter this code for successful verification.');
        console.warn('-----------------------------------');
        return true; 
    }
    return false;
};

const recalculateHelperRating = async (helperId) => {
    const helper_objectId = new ObjectId(helperId);
    
    const reviewStats = await Review.aggregate([
        { '$match': { 'helperId': helperId } },
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
    } else {
        await Helper.updateOne(
            { '_id': helper_objectId },
            {
                '$set': {
                    'rating': 5.0,
                    'reviews': 0
                }
            }
        );
    }
};

app.post('/api/otp/request', async (req, res) => {
    try {
        const { userId, type, contact } = req.body;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        const otp = generateOTP();
        
        await OTP.deleteMany({ userId, type });
        const newOTP = new OTP({ userId, otp, type });
        await newOTP.save();

        const sent = await sendVerificationCode(contact, otp, type);
        
        if (!sent && type !== 'email') { 
            return res.status(500).json({ message: `Failed to send ${type} verification code. Check server logs.` });
        }

        res.json({ message: `Verification code sent to your ${type}.` });

    } catch (err) {
        if (err.message.includes('Failed to send verification email')) {
            return res.status(500).json({ message: 'Email service error. Check host connection or App Password.' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/otp/verify', async (req, res) => {
    try {
        const { userId, otp, type } = req.body;
        
        const storedOTP = await OTP.findOne({ userId, otp, type });

        if (!storedOTP) {
            return res.status(400).json({ message: "Invalid or expired verification code." });
        }

        const updateField = type === 'email' ? { isEmailVerified: true } : { isPhoneVerified: true };
        const updatedUser = await User.findByIdAndUpdate(userId, updateField, { new: true });

        await OTP.deleteOne({ _id: storedOTP._id });

        if (!updatedUser) {
             return res.status(404).json({ message: "User not found after verification." });
        }

        res.json({ 
            message: `${type} verified successfully.`,
            user: { 
                id: updatedUser._id, 
                name: updatedUser.fullName, 
                email: updatedUser.email, 
                role: updatedUser.role,
                isEmailVerified: updatedUser.isEmailVerified, 
                isPhoneVerified: updatedUser.isPhoneVerified,
                image: updatedUser.image, 
                phone: updatedUser.phone, 
                address: updatedUser.address, 
                bio: updatedUser.bio
            }
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
                image: user.image, phone: user.phone, address: user.address, bio: user.bio,
                isEmailVerified: user.isEmailVerified, isPhoneVerified: user.isPhoneVerified
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
                     image: user.image, phone: user.phone, address: user.address, bio: user.bio,
                     isEmailVerified: user.isEmailVerified, isPhoneVerified: user.isPhoneVerified
        } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const updateFields = req.body;
        
        if (!updateFields || Object.keys(updateFields).length === 0) {
             return res.status(400).json({ message: "Request body is empty." });
        }

        const updatedUser = await User.findOneAndUpdate(
            { email: email }, 
            { $set: updateFields },
            { new: true } 
        );

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        if (updatedUser.role === 'helper') {
            const helperUpdateData = {
                name: updateFields.fullName || updatedUser.fullName,
                image: updateFields.image || updatedUser.image,
                location: updateFields.address || updatedUser.address,
                bio: updateFields.bio || updatedUser.bio
            };
            
            await Helper.findOneAndUpdate(
                { email: email },
                { $set: helperUpdateData },
                { new: false }
            );
        }

        res.json({ 
            message: "Profile updated successfully", 
            user: {
                name: updatedUser.fullName, email: updatedUser.email, role: updatedUser.role,
                image: updatedUser.image, phone: updatedUser.phone, address: updatedUser.address, bio: updatedUser.bio,
                isEmailVerified: updatedUser.isEmailVerified, isPhoneVerified: updatedUser.isPhoneVerified
            }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:email/image-upload', upload.single('image'), async (req, res) => {
    try {
        const email = req.params.email;
        let newImageUrl = null;
        
        if (!req.file) {
            return res.status(400).json({ message: "No file provided." });
        }

        const uploadResult = await uploadStream(req, 'user-avatars');
        newImageUrl = uploadResult.secure_url;

        const updatedUser = await User.findOneAndUpdate(
            { email },
            { $set: { image: newImageUrl } },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found." });
        }

        if (updatedUser.role === 'helper') {
            await Helper.findOneAndUpdate(
                { email },
                { $set: { image: newImageUrl } }
            );
        }
        
        res.json({ 
            message: "Image updated successfully", 
            user: { 
                ...updatedUser.toObject(), 
                image: newImageUrl, 
                name: updatedUser.fullName 
            } 
        });

    } catch (err) {
        console.error("User image upload error:", err);
        res.status(500).json({ error: "Server Error during image upload.", detailedError: err.message });
    }
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
                    status: 'Pending'
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

app.put('/api/helper-profile/:email', upload.single('image'), async (req, res) => {
    try {
        const email = req.params.email;
        const { role, price, location, experience, bio, description, imageURL } = req.body;
        
        const updateData = { role, price, location, experience, bio, description };
        let newImageUrl = null;

        if (req.file) {
            const uploadResult = await uploadStream(req, 'helper-profiles');
            newImageUrl = uploadResult.secure_url; 
        } else if (imageURL) {
            newImageUrl = imageURL;
        }

        if (newImageUrl) {
            updateData.image = newImageUrl;
        }

        const updatedHelper = await Helper.findOneAndUpdate(
            { email },
            { $set: updateData },
            { new: true }
        );

        if (!updatedHelper) {
            return res.status(404).json({ message: "Helper profile not found" });
        }
        
        if (newImageUrl) {
             await User.findOneAndUpdate(
                { email },
                { $set: { image: newImageUrl, bio: bio, address: location } }
            );
        }
        
        res.json(updatedHelper);
    } catch (err) { 
        console.error("Helper profile update error:", err);
        res.status(500).json({ error: "Server Error during profile update.", detailedError: err.message }); 
    }
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

app.get('/api/reviews', async (req, res) => {
    try { const reviews = await Review.find().sort({ timestamp: -1 }); res.json(reviews); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reviews', async (req, res) => {
    try {
        const data = req.body;
        const required_fields = ['helperId', 'rating', 'reviewText', 'bookingId', 'reviewerName'];
        
        const all = (arr, fn = Boolean) => arr.every(fn);
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
        
        await recalculateHelperRating(data.helperId);

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

app.put('/api/reviews/:id', async (req, res) => {
    try {
        const reviewId = req.params.id;
        const { rating, reviewText } = req.body;

        const updatedReview = await Review.findByIdAndUpdate(
            reviewId,
            { $set: { rating, reviewText } },
            { new: true }
        );

        if (!updatedReview) {
            return res.status(404).json({ message: "Review not found." });
        }
        
        await recalculateHelperRating(updatedReview.helperId);

        res.json(updatedReview);
    } catch (err) {
        console.error("Error updating review:", err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/reviews/:id', async (req, res) => {
    try {
        const reviewId = req.params.id;
        const deletedReview = await Review.findByIdAndDelete(reviewId);

        if (!deletedReview) {
            return res.status(404).json({ message: "Review not found." });
        }

        await Booking.updateOne(
            { id: deletedReview.bookingId },
            { '$set': { 'isReviewed': false } }
        );
        
        await recalculateHelperRating(deletedReview.helperId);

        res.json({ message: "Review deleted and helper rating recalculated. Booking marked as unreviewed." });
    } catch (err) {
        console.error("Error deleting review:", err);
        res.status(500).json({ error: err.message });
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

const all = (arr, fn = Boolean) => arr.every(fn);

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});