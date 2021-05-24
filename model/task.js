const mongoose = require("mongoose");

const Task = new mongoose.Schema({
    title: { type: String, required: true },
    description : { type: String, required: true },
    expiryDate: { type: Date, required: true },
    done: { type: Boolean, default: false },
    createdBy: { type: mongoose.Types.ObjectId, ref: 'user' },
    assignedTo: { type: mongoose.Types.ObjectId, ref: 'user' },
    assignedBack: { type: Boolean, default: false },
    assignedBackOn: { type: Date }
})
module.exports = mongoose.model("task", Task)