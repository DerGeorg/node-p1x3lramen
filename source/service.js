import express from 'express';
const fileUpload = require('express-fileupload');
import mqtt from 'mqtt'
import {
	testClockIntegration,
	testLigtingIntegration,
	testDateTimeIntegration,
	testClimateIntegration,
	testBrightnessIntegration
} from './integration.js';
import {rejects} from "assert";


const DEFAULTS = {
	port: 8000,
	autoConnect: true
};


export default class Service {
	constructor(settings) {
		this.config = Object.assign({}, DEFAULTS, settings.service)
		this.connection = null;
		this.device = null;
		this.app = null;
		// this.client = new MqttHandler(this.doScore);
		if(settings.mqtt.on) {
			this.connect();
		}
		// this.mqttconfig = settings;
		// this.client = null;
	}

	start(connection, device) {
		if (this.app) {
			console.log("Service is already running and needs to be stopped first.");
			return;
		}

		this.connection = connection;
		this.device = device;
		this.app = express();
		this.app.use(fileUpload({
			createParentPath: true
		}));

		let apiRouter = express.Router();
		apiRouter.use(this._autoconnect.bind(this));
		apiRouter.get("/fullday", this._fullday.bind(this));
		apiRouter.get("/datetime", this._datetime.bind(this));
		apiRouter.get("/brightness", this._brightness.bind(this));
		apiRouter.get("/lighting", this._lighting.bind(this));
		apiRouter.get("/clock", this._clock.bind(this));
		apiRouter.get("/score", this._score.bind(this));
		apiRouter.get("/visualization", this._visualization.bind(this));
		apiRouter.get("/effect", this._effect.bind(this));
		apiRouter.get("/climate", this._climate.bind(this));
		//ScreenOff Feature
		apiRouter.get("/screenOff", this._screenOFF.bind(this));
		//IMG Feature
		apiRouter.post("/upload", this._upload.bind(this));
		apiRouter.get("/img", this._setImg.bind(this));

		// routes

		this.app.use('/', express.static('public'));

		this.app.get("/api/status", this._status.bind(this));
		this.app.get("/api/connect", this._connect.bind(this));
		this.app.get("/api/disconnect", this._disconnect.bind(this));
		this.app.use('/api', apiRouter);

		this.app.get("/test", this._test.bind(this));

		this.app.listen(this.config.port, async () => {
			console.log(`Listening on http://localhost:${this.config.port}`);

		});

		// if(this.mqttconfig.mqtt.on){
		// 	console.log("starte mqtt")
		// 	var options = {
		// 		port: this.mqttconfig.port,
		// 		host: this.mqttconfig.address,
		// 		clientId: this.mqttconfig.clientId,
		// 		username: this.mqttconfig.username,
		// 		password: this.mqttconfig.pw,
		// 		protocol: 'mqtt'
		// 	}
		// 	console.log("starte mqtt 2")
		// 	// var client = mqtt.connect(options)
		// 	this.client = mqtt.connect('ws://192.168.1.116:1883', {
		// 		clientId: 'nodePixooClient'
		// 	});
		// 	console.log("starte mqtt 3")
		// 	this.client.on("connect", () => {
		// 		console.log("MQTT connected");
		// 		this.client.subscribe("top")
		// 		setInterval(() => client.publish('presence', `Hello mqtt`), 2000);
		// 	})
		// 	console.log("starte mqtt 4")
		// 	this.client.on('message', function (topic, message) {
		// 		console.log("topic: " + topic + " msg:" + message)
		// 	});
		// 	console.log("starte mqtt 5")

		// }
	}

	async _upload(req, res) {
		let sampleFile;
		let uploadPath;
		if (!req.files || Object.keys(req.files).length == 0) {
			return res.status(400).send('No files were uploaded.');
		}
		// The name of the input field (i.e. "sampleFile") is used to retrieve the uploaded file
		sampleFile = req.files.file;
		uploadPath = 'public' + '/uploads/' + sampleFile.name;
		// Use the mv() method to place the file somewhere on your server
		sampleFile.mv(uploadPath, async function (err) {
			if (err)
				return console.error(err);
		})
		return res.status(200).send(uploadPath);
	}

	async _setImg(req, res) {
		const settings = {};
		if (typeof req.query.path === 'string') {
			settings.path = req.query.path;
		}
		await this.device.setImg(settings.path).then(result => {
			this.connection.writeImage(result.asBinaryBuffer());
			return this._status(req, res);
		})
	}

	async _screenOFF(req, res) {
		const settings = {};
		if (typeof req.query.enable === 'string') {
			settings.enable = req.query.enable === 'true' ? true : false;
		}
		const msg = this.device.powerScreen(settings);
		this.connection.writeAll(msg);
		return this._status(req, res);
	}

	stop() {
		this.app = null;
	}

	// --- connection and status handlers ---

	async _autoconnect(req, res, next) {
		if (this.config.autoConnect && !!this.connection.isConnected() === false) {
			await this.connection.connect();
		}
		next();
	}

	_status(req, res) {
		return res.status(200).json({
			connected: this.connection.isConnected(),
			config: this.device.config
		});
	}

	async _connect(req, res) {
		if (!!this.connection.isConnected() === false) {
			await this.connection.connect();
		}
		return this._status(req, res);
	}

	async _disconnect(req, res) {
		if (!!this.connection.isConnected() === true) {
			await this.connection.disconnect();
		}
		return this._status(req, res);
	}

	// --- basic commands ---

	async _brightness(req, res) {
		const settings = {};
		if (req.query.level && parseInt(req.query.level, 10)) {
			settings.level = parseInt(req.query.level, 10);
		}

		const msg = this.device.brightness(settings);
		this.connection.writeAll(msg);

		return this._status(req, res);
	}

	async _fullday(req, res) {
		const settings = {};

		if (typeof req.query.enable === 'string') {
			settings.enable = req.query.enable === 'true' ? true : false;
		}
		const msg = this.device.fullday(settings);
		this.connection.writeAll(msg);

		return this._status(req, res);
	}

	async _datetime(req, res) {
		const settings = {};
		let msg = "";

		settings.date = typeof req.query.date === "string" ? new Date(req.query.date) : new Date();
		msg = this.device.datetime(settings);
		this.connection.writeAll(msg);

		if (typeof req.query.fulldayMode === 'string') {
			settings.enable = req.query.fulldayMode === 'true' ? true : false;
			msg = this.device.fullday(settings);
			this.connection.writeAll(msg);
		}

		return this._status(req, res);
	}

	async _climate(req, res) {
		const settings = {};
		if (req.query.weather && parseInt(req.query.weather, 10)) {
			settings.weather = parseInt(req.query.weather, 10);
		}
		if (req.query.temperature && parseInt(req.query.temperature, 10)) {
			settings.temperature = parseInt(req.query.temperature, 10);
		}
		const msg = this.device.climate(settings);
		this.connection.writeAll(msg);

		return this._status(req, res);
	}

	// --- channel commands ---

	async _lighting(req, res) {
		const settings = {};
		if (req.query.color) {
			settings.color = req.query.color;
		}
		if (req.query.brightness && parseInt(req.query.brightness, 10)) {
			settings.brightness = parseInt(req.query.brightness, 10);
		}
		if (req.query.mode && parseInt(req.query.mode, 10)) {
			settings.mode = parseInt(req.query.mode, 10);
		}
		if (typeof req.query.powerScreen === 'string') {
			settings.powerScreen = req.query.powerScreen === 'true' ? true : false;
		}

		const msg = this.device.lighting(settings);
		this.connection.writeAll(msg);

		return this._status(req, res);
	}

	async _clock(req, res) {
		const settings = {};

		if (req.query.mode && parseInt(req.query.mode, 10)) {
			settings.mode = parseInt(req.query.mode, 10);
		}
		if (typeof req.query.showTime === 'string') {
			settings.showTime = req.query.showTime === 'true' ? true : false;
		}
		if (typeof req.query.showWeather === 'string') {
			settings.showWeather = req.query.showWeather === 'true' ? true : false;
		}
		if (typeof req.query.showTemperature === 'string') {
			settings.showTemperature = req.query.showTemperature === 'true' ? true : false;
		}
		if (typeof req.query.showCalendar === 'string') {
			settings.showCalendar = req.query.showCalendar === 'true' ? true : false;
		}
		if (typeof req.query.color === 'string' && req.query.color.length === 6) {
			settings.color = req.query.color;
		}
		const msg = this.device.clock(settings);
		this.connection.writeAll(msg);

		return this._status(req, res);
	}

	async _score(req, res) {
		const settings = {};
		if (req.query.red && parseInt(req.query.red, 10)) {
			settings.red = parseInt(req.query.red, 10);
		}
		if (req.query.blue && parseInt(req.query.blue, 10)) {
			settings.blue = parseInt(req.query.blue, 10);
		}
console.log(settings)
		this.doScore(settings)

		return this._status(req, res);
	}


	async _effect(req, res) {
		const settings = {};
		if (req.query.mode && parseInt(req.query.mode, 10)) {
			settings.mode = parseInt(req.query.mode, 10);
		}

		const msg = this.device.effect(settings);
		this.connection.writeAll(msg);

		return this._status(req, res);
	}

	async _visualization(req, res) {
		const settings = {};
		if (req.query.mode && parseInt(req.query.mode, 10)) {
			settings.mode = parseInt(req.query.mode, 10);
		}

		const msg = this.device.visualization(settings);
		this.connection.writeAll(msg);

		return this._status(req, res);
	}

	// --- integration tests ---

	async _test(req, res) {
		let testDelay = req.query.delay ? parseInt(req.query.delay, 10) : 2000;

		// testing the date time 
		await testDateTimeIntegration(this.device, this.connection, testDelay);

		// testing the brightness changes
		await testBrightnessIntegration(this.device, this.connection, testDelay);

		// test the clock channel 
		await testClockIntegration(this.device, this.connection, testDelay);

		// test the lighting channel
		await testLigtingIntegration(this.device, this.connection, testDelay);

		// test weather and temperature
		await testClimateIntegration(this.device, this.connection, testDelay);

		let message;
		message = this.device.datetime();
		this.connection.writeAll(message);

		message = this.device.clock({
			mode: 6,
			showTime: true,
			showWeather: false,
			showTemperature: false,
			showCalendar: false,
			color: 'ffffff'
		});
		this.connection.writeAll(message);

		return this._status(req, res);
	}


	async doScore(settings) {
		const msg = this.device.score(settings);
		this.connection.writeAll(msg);
	}

	async doScoreCb(topic, message){
		const json = JSON.parse(message.toString())
		const settings = {
			red: json.red,
			blue: json.blue
		}
		if(!this.connection.isConnected()) {
			this.connection.connect().then(() => {
				new Promise((resolve, reject) => {
					resolve(this.doScore(settings))
				})
			})
		}else {
			new Promise((resolve, reject) => {
				resolve(this.doScore(settings))
			})
		}
	}


	async connect() {
		// Connect mqtt with credentials (in case of needed, otherwise we can omit 2nd param)
		this.mqttClient = mqtt.connect('mqtt://192.168.1.116:1883');//, {clientId: 'bgtestnodejs', protocolId: 'mqtt', protocolVersion: 3, connectTimeout:1000, debug:true});//{ username: this.username, password: this.password });

		// Mqtt error calback
		this.mqttClient.on('error', (err) => {
			console.log(err);
			this.mqttClient.end();
		});

		// Connection callback
		this.mqttClient.on('connect', () => {
			console.log(`mqtt client connected`);
		});

		// mqtt subscriptions
		this.mqttClient.subscribe('mytopic', {qos: 0});

		// When a message arrives, console.log it
		this.mqttClient.on('message', async (topic, message) => await this.doScoreCb(topic, message));

		this.mqttClient.on('close', () => {
			console.log(`mqtt client disconnected`);
		});
	}

	// Sends a mqtt message to topic: mytopic
	sendMessage(message) {
		this.mqttClient.publish('mytopic', message);
	}


}