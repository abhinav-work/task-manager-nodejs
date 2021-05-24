const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { CronJob } = require('cron');
const moment = require('moment');

const app = express();
const { AuthChecker, GenerateToken } = require('./middleware/token');

const TaskModel = require('./model/task');
const UserModel = require('./model/user');


const DB_URL = "mongodb+srv://admin:12345@cluster0.jdszd.mongodb.net/task-manager?authSource=admin&replicaSet=atlas-u3y84t-shard-0&readPreference=primary&appname=MongoDB%20Compass&ssl=true"

app.use(cors({origin: '*'}));
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }));

app.post('/addTask', AuthChecker, async(req, res, next) => {
    const { title, description, expiryDate, assignedTo, user } = req.body;
    if(!(title && description && expiryDate && assignedTo)) {
        return res.send({code: 422, message: 'Missing Parameters'});
    }
    await new TaskModel({
        title, 
        description,
        expiryDate,
        assignedTo: assignedTo._id,
        createdBy: user._id,
    }).save()
    return res.send({code: 204, message: 'Task added successfully'})
})

app.get('/getTasks', AuthChecker, async(req, res, next) => {
    const data = await TaskModel.aggregate([
        { 
            $sort: { 
                done: 1, 
                expiryDate: 1 
            }
        },
        {
            $lookup: {
                from: "users",
                let: {
                    "assignedToId": "$assignedTo"
                },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: [ "$_id", "$$assignedToId" ] }
                        }
                    },
                ],
                as: "assignedTo"
            }
        },
        {
            $unwind: {
                path: "$assignedTo",
                preserveNullAndEmptyArrays: true,
            }
        },
        {
            $addFields: {
                assignedTo: "$assignedTo.name"
            }
        }
    ]);

    res.send({code: data.length ? 200 : 204, data})
})

app.get('/getTask', AuthChecker, async(req, res, next) => {
    const { id } = req.query;
    if(!id) {
        return res.send({code: 422, message: 'Missing Parameters'})
    }
    const [data] = await TaskModel.aggregate([
        {
            $match: {
                _id: mongoose.Types.ObjectId(id)
            }
        },
        {
            $lookup: {
                from: "users",
                let: {
                    "assignedToId": "$assignedTo"
                },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: [ "$_id", "$$assignedToId" ] }
                        }
                    },
                    {
                        $project: {
                            password: 0
                        }
                    }
                ],
                as: "assignedTo"
            }
        },
        {
            $unwind: {
                path: "$assignedTo",
                preserveNullAndEmptyArrays: true,
            }
        },
    ]);
    if(data) {
        res.send({code: 200, data})
    }
    else {
        res.send({code: 404, message: "Requested data not found"})
    }
})

app.put('/updateTask', AuthChecker, async(req, res, next) => {
    const body = Object.assign({ }, req.body);
    if(!req.body._id) {
        return res.send({code: 422, message: 'Missing Parameters'})
    }
    delete body._id;
    if(body.assignedTo) {
        body.assignedTo = body.assignedTo._id;
    }
    const updatedTask = await TaskModel.findOneAndUpdate({ _id: req.body._id }, body, { lean: true })
    if(!updatedTask) {
        return res.send({code: 404, message: 'No such resource found'})
    }
    return res.send({code: 204, message: 'Task updated successfully'})
})

app.delete('/deleteTask', AuthChecker, async(req, res, next) => {
    const { _id } = Object.assign({ }, req.body);
    if(!_id) {
        return res.send({code: 422, message: 'Missing Parameters'})
    }
    await TaskModel.deleteOne({ _id })
    return res.send({code: 204, message: 'Task deleted successfully'})
})

app.post('/user/register', async(req, res, next) => {
    let { name, email, password } = req.body;
    if(!(name && email && password)) {
        return res.send({code: 422, message: 'Missing Parameters'})
    }
    email = email.toLowerCase().trim();
    name = name.trim();
    const nameOrEmailExists = await UserModel.findOne({ $or: [ {name}, {email} ]});
    if(nameOrEmailExists) {
        return res.send({code: 409, message: 'Name or Email already exists!'})
    }
    const passwordToBeSaved = await bcrypt.hash(password, 10);
    await new UserModel({
        name,
        email,
        password: passwordToBeSaved,
    }).save();
    return res.send({code: 200, message: "User registered successfully!"});
})

app.post('/user/login', async(req, res, next) => {
    const { email, password } = req.body;
    if(!(password && email)) {
        return res.send({code: 422, message: 'Missing Parameters'})
    }
    const userExists = await UserModel.findOne({ email }, { }, { lean: true });
    if(!userExists) {
        return res.send({code: 404, message: "No such user found" })
    }
    const passwordMatch = await bcrypt.compare(password, userExists.password);
    if(!passwordMatch) {
        return res.send({code: 401, message: "Email and Password donot match" })
    }
    const accessToken = await GenerateToken({ payload: userExists });
    return res.send({code: 200, message: "User logged in successfully!", data: { accessToken, user: userExists.name } });
})

app.get('/user/getUsers', async(req, res, next) => {
    const data = await UserModel.find({}, {password: 0});
    return res.send({code: 200, data})
})

mongoose.connect(DB_URL, (err) => {
    if(err) {
        console.log("Error connecting to database");
    }
    else {
        console.log("Database connected successfully")
    }
})
app.listen(3000, (err) => {
    console.log("Server up and running @ 3000")
})


// CRON JOB TO ASSIGN BACK EXPIRED TASKS
new CronJob('* * * * *', async () => {
    const expiryInNextMinuteTime = new Date(moment().add(1, 'minute').toDate());
    const expiredTasks = await TaskModel.find({ expiryDate: { $lte: expiryInNextMinuteTime }, $expr: { $ne: [ "$createdBy", "$assignedTo" ] } }, {}, {lean: true});
    expiredTasks.forEach(async(task) => {
        await TaskModel.updateOne({ _id: task._id }, { assignedTo: task.createdBy, assignedBack: true, assignedBackOn: new Date() })
    })
	console.log(`Assigned ${expiredTasks.length} Expired Tasks Back To Creator @ ${new Date().toUTCString()} `);
}, null, true); 
