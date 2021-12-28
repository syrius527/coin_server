const crypto = require('crypto');
const {User, Coin, Key} = require("./Models");
const axios = require("axios");
const jwt = require('jsonwebtoken');

const encryptPassword = (password) => {
    return crypto.createHash('sha512').update(password).digest('base64');
}

const setAuth = async (req, res, next) => {
    const authorization = req.headers.authorization;
    const [bearer, key] = authorization.split(' ');
    if (bearer !== 'Bearer') {
        return res.send({error: 'Wrong Authorization'}).status(400);
    }
    //console.log(jwt.verify(key, authKey.secretKey));
    try {
        const {publicKey} = jwt.decode(key);
        const authKey = await Key.findOne({publicKey: publicKey});
        jwt.verify(key, authKey.secretKey);
        const user = await authKey.user;
        if (!user){
            return res.send({error: 'Cannot find user'}).status(404);
        }
        req.user = user;
        return next();
    } catch (err) {
        if (err.name === 'TypeError'){
            return res.send({error: 'Invalid token'}, ).status(401);
        } else if (err.name === 'TokenExpiredError') {
            return res.send({error: 'Expired token'}, ).status(401);
        }
    }
}

const checkCoin = async (req, res, next) => {
    const {coin_name} = req.params;
    const _coin = await Coin.findOne({name: coin_name});
    if (_coin === null) {
        return res.send({error: 'Invalid coin ID'}).status(404);
    } else {
        next();
    }
}

const getCoinPrice = async (coinName) => {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinName}&vs_currencies=usd`;
    const apiRes = await axios.get(url);
    const price = apiRes.data[coinName].usd;
    return price;
}

module.exports = {
    encryptPassword,
    setAuth,
    checkCoin,
    getCoinPrice,

}