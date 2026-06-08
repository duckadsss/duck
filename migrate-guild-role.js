require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
}

mongoose.connect(uri).then(async () => {
    const result = await mongoose.connection.db.collection('users').updateMany(
        { guildRole: { $exists: false } },
        { $set: { guildRole: null } }
    );
    console.log(`Updated ${result.modifiedCount} documents`);
    await mongoose.disconnect();
}).catch(err => {
    console.error(err);
    process.exit(1);
});
