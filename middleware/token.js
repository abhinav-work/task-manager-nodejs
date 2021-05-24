const jsonWebToken = require('jsonwebtoken');
const UserModel = require('../model/user');

exports.GenerateToken = ({ payload }) => 
	new Promise ( async(resolve, reject) => {
		try {
			return resolve (jsonWebToken.sign( payload, 'secret', { expiresIn: '1h' } ))
		}
		catch(err) {
			return reject(err)
		}
	})

const VerifyToken = ({ token }) => 
	new Promise ( async(resolve, reject) => {
			try {
				let { _id } = jsonWebToken.verify( token, 'secret' );
				if(!_id) {
					return reject({ code: 403 , error: 'Unauthorised'});
				}
				const userExists = await UserModel.findOne({ _id }, { password: 0 });
				if(!userExists) {
					return reject({ code: 403 , error: 'Unauthorised'});
				}
				return resolve ({user: userExists})
			}
			catch(err) {
				return reject(err)
			}
		})

exports.AuthChecker = ( req, res, next) => 
	new Promise ( async(resolve, reject) => {
		try {
			const token = ((req || {}).headers || {}).authorisation;
			if(!token) {
				return res.send({ code: 401 , error: 'Unauthorised'})
			}
			Object.assign(req.body, await VerifyToken({ token }));
			return resolve ( next() )  
		}
		catch(err) {
			return reject(err)
		}
	})