const express = require('express');
const { body, validationResult, check} = require('express-validator');
const crypto = require('crypto');
const {encryptPassword, setAuth, checkCoin, getCoinPrice} = require('./utils');
const mongoose = require('mongoose');
const axios = require("axios");
const jwt = require('jsonwebtoken');
const {User, Coin, Asset, Key} = require('./Models');


const app = express();
const port = 3000;

app.use(express.urlencoded({extended: true}));// body에 담은 내용을 어떻게 읽어올건지에 대한 세팅
app.use(express.json());

app.get('/', (req, res)=> {
    res.send('hello');
});

app.get('/coins', async (req, res) => {
    const coins = await Coin.find({isActive: true});
    let coinIds = [];
    for (let i = 0; i<coins.length; i++) {
        coinIds.push(coins[i].name);
    }
    res.send(coinIds).status(200);
});

app.post('/register',
    body('email').isEmail(),
    body('email').isLength({ max: 99 }),
    body('name').isLength({ min: 4, max: 12 }),
    body('password').isLength({ min: 8, max: 16 }),// 제약조건
    async (req, res)=> {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

    const {name, email, password} = req.body;
    const encryptedPassword = encryptPassword(password);
    let user = null;
    try{
        user = new User({name: name, email: email, password: encryptedPassword});
        await user.save();
    } catch (err) {
        return res.send({error: 'email is duplicated'}).status(400);
    }

    // usd 10000$
    const usdAsset = new Asset({name: 'USD', balance: 10000, user});
    await usdAsset.save();

    const coins = await Coin.find({isActive: true});
    for(const coin of coins) {
        const asset = new Asset({name: coin.name, balance: 0, user});
        await asset.save();
    }

    res.send({}).status(200);
});

app.post('/login', async (req, res)=> {
    const {email, password} = req.body;
    const encryptedPassword = encryptPassword(password);
    const user = await User.findOne({email: email, password: encryptedPassword});
    if (user === null) {
        return res.send({error: 'Not Found'}).status(404);
    }

    const key = new Key({publicKey: encryptPassword(crypto.randomBytes(20)),
                        secretKey: encryptPassword(crypto.randomBytes(20)), user});
    await key.save();
    console.log(jwt.sign({publicKey: key.publicKey}, key.secretKey, {expiresIn: 1}));
    res.send({'key': {publicKey: key.publicKey, secretKey: key.secretKey}}).status(200);
});

app.get('/balance', setAuth, async (req, res)=> {
    const user = req.user;
    const assets = await Asset.find({balance:{$ne : 0}, user},{name:1, balance:1, _id:0});

    let userAssets = {};
    for (let i=0; i<assets.length; i++) {
        userAssets[assets[i].name] = assets[i].balance;
    }
    res.send(userAssets).status(200);
});

app.get('/coins/:coin_name',checkCoin , async (req, res) => {
    const {coin_name} = req.params;
    const coinPrice = {"price": await getCoinPrice(coin_name)};
    res.send(coinPrice).status(200);
})

app.post('/coins/:coin_name/buy', checkCoin, setAuth, async (req, res) => {
    const user = req.user;
    const {coin_name} = req.params;

    const usdAsset = await Asset.findOne({name: 'USD', user});
    const coinAsset = await Asset.findOne({name: coin_name, user});

    const coinPrice = await getCoinPrice(coin_name);
    const {all} = req.body;
    let {quantity} = req.body;

    if (all === 'true') {
        if (usdAsset.balance === 0) {
            return res.send({error : 'no usd left'}).status(422);
        } else{
            let allQuantity = usdAsset.balance/coinPrice;
            allQuantity = Math.floor(allQuantity*10000)/10000;
            if (allQuantity === 0){
                return res.send({error : 'no usd left'}).status(422);
            }
            usdAsset.balance -= allQuantity*coinPrice;
            coinAsset.balance = allQuantity;
            await usdAsset.save();
            await coinAsset.save();
            return res.send({'price': coinPrice, 'quantity': allQuantity});
        }
    } else {
        let arr=[0, 0];
        if (parseInt(quantity) === parseFloat(quantity)) {
            arr = [parseInt(quantity), 0];
        } else {
            arr = quantity.split('.');
        }
        if (arr[1].length > 4){
            return res.send({error: 'quantity overflow'}).status(400);
        } else {
            quantity = parseFloat(quantity);
            const cost = coinPrice * quantity;
            if (cost > usdAsset.balance) {
                return res.send({error: 'not enough usd'}).status(400);
            } else {
                usdAsset.balance -= cost;
                coinAsset.balance += quantity;
                await usdAsset.save();
                await coinAsset.save();
                return res.send({'price': coinPrice, "quantity": quantity })
            }
        }
    }
})

app.post('/coins/:coin_name/sell', checkCoin, setAuth, async (req, res) => {
    const user = req.user;
    const {coin_name} = req.params;

    const usdAsset = await Asset.findOne({name: 'USD', user});
    const coinAsset = await Asset.findOne({name: coin_name, user});

    const coinPrice = await getCoinPrice(coin_name);
    const {all} = req.body;
    let {quantity} = req.body;

    if (all === 'true') {
        if (coinAsset.balance === 0) {
            return res.send({error: `no ${coin_name} left`}).status(422);
        } else{
            const allQuantity = coinAsset.balance;
            usdAsset.balance += allQuantity*coinPrice;
            coinAsset.balance = 0;
            await usdAsset.save();
            await coinAsset.save();
            return res.send({'price': coinPrice, 'quantity': allQuantity});
        }
    } else {
        let arr=[0, 0];
        if (parseInt(quantity) === parseFloat(quantity)) {
            arr = [parseInt(quantity), 0];
        } else {
            arr = quantity.split('.');
        }
        if (arr[1].length > 4){
            return res.send({error: 'quantity overflow'}).status(400);
        } else {
            quantity = parseFloat(quantity);
            if (quantity > coinAsset.balance) {
                return res.send({error: `not enough ${coin_name}`}).status(400);
            } else {
                const cost = coinPrice * quantity;
                usdAsset.balance += cost;
                coinAsset.balance -= quantity;
                await usdAsset.save();
                await coinAsset.save();
                return res.send({'price': coinPrice, "quantity": quantity });
            }
        }
    }
})

app.listen(port, ()=> {
    console.log(`listening at port: ${port}...`);
});