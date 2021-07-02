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
		this.mqttsettings = null
		if(settings.mqtt.on) {
			this.mqttsettings = settings.mqtt
			this.connect(settings.mqtt);
		}
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

	/**
	 * Upload Image to public/uploads/<FILENAME>
	 * @param req Request, send multipart/form with the key 'file'
	 * @param res Response
	 * @return {Promise<*>} HTTP Status
	 * @private
	 */
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

	/**
	 * Stop App
	 */
	stop() {
		this.app = null;
	}

	/**
	 * Express middleware for keeping BLE connection
	 * @param req Request
	 * @param res Response
	 * @param next Next
	 * @return {Promise<void>}
	 * @private
	 */
	async _autoconnect(req, res, next) {
		if (this.config.autoConnect && !!this.connection.isConnected() === false) {
			await this.connection.connect();
		}
		next();
	}

	// Disconnect
	/**
	 * Disconnect REST Api
	 * Getting the req params and creating settings for Disconnect
	 * @param req Request
	 * @param res Response
	 * @return {*} HTTP Status
	 * @private
	 */
	async _disconnect(req, res) {
		await this.disconnectCb()
		return this._status(req, res);
	}

	/**
	 * Disconnect from BLE
	 */
	async disconnectCb(){
		if (!!this.connection.isConnected() === true) {
			await this.connection.disconnect();
		}
	}

	// Brightness
	/**
	 * Brightness REST Api
	 * Getting the req params and creating settings for Brightness
	 * @param req Request
	 * @param res Response
	 * @return {*} HTTP Status
	 * @private
	 */
	async _brightness(req, res) {
		const settings = {};
		if (req.query.level && parseInt(req.query.level, 10)) {
			settings.level = parseInt(req.query.level, 10);
		}



		return this._status(req, res);
	}

	/**
	 * Do Brightness for REST Api & MQTT Api
	 * @param settings Settings to send {"level":<int>}
	 * @return {Promise<void>}
	 */
	async doBrightness(settings){
		const msg = this.device.brightness(settings);
		this.connection.writeAll(msg);
	}

	/**
	 * Do Brightness Callback for MQTT
	 * @param topic Topic to send
	 * @param message Message to send {"level":<int>}
	 * @return {Promise<void>}
	 */
	async doBrightnessCb(topic, message){
		const json = JSON.parse(message.toString())
		const settings = {
			level: json.level}
		if(!this.connection.isConnected()) {
			this.connection.connect().then(() => {
				new Promise((resolve, reject) => {
					resolve(this.doBrightness(settings))
				})
			})
		}else {
			new Promise((resolve, reject) => {
				resolve(this.doBrightness(settings))
			})
		}
	}

	// Fullday
	/**
	 * Fullday REST Api
	 * Getting the req params and creating settings for Fullday
	 * @param req Request
	 * @param res Response
	 * @return {*} HTTP Status
	 * @private
	 */
	async _fullday(req, res) {
		const settings = {};

		if (typeof req.query.enable === 'string') {
			settings.enable = req.query.enable === 'true' ? true : false;
		}
		this.doFullday(settings)

		return this._status(req, res);
	}

	/**
	 * Do Fullday for REST Api & MQTT Api
	 * @param settings Settings to send {enable:<bool>}
	 * @return {Promise<void>}
	 */
	async doFullday(settings){
		const msg = this.device.fullday(settings);
		this.connection.writeAll(msg);
	}

	/**
	 * Do Fullday Callback for MQTT
	 * @param topic Topic to send
	 * @param message Message to send {"enable":<bool>}
	 * @return {Promise<void>}
	 */
	async doFulldayCb(topic, message){
		const json = JSON.parse(message.toString())
		const settings = {
			enable: json.enable}
		if(!this.connection.isConnected()) {
			this.connection.connect().then(() => {
				new Promise((resolve, reject) => {
					resolve(this.doFullday(settings))
				})
			})
		}else {
			new Promise((resolve, reject) => {
				resolve(this.doFullday(settings))
			})
		}
	}

	//DateTime

	/**
	 * DateTime REST Api
	 * Getting the req params and creating settings for DateTime
	 * @param req Request
	 * @param res Response
	 * @return {*} HTTP Status
	 * @private
	 */
	async _datetime(req, res) {
		const settings = {};
		let msg = "";

		settings.date = typeof req.query.date === "string" ? new Date(req.query.date) : new Date();
		msg = this.device.datetime(settings);
		this.connection.writeAll(msg);

		if (typeof req.query.fulldayMode === 'string') {
			settings.enable = req.query.fulldayMode === 'true' ? true : false;
			this.doDateTime(settings)
		}

		return this._status(req, res);
	}

	/**
	 * Do DateTime for REST Api & MQTT Api
	 * @param settings Settings to send {"date":<string>, "fulldayMode":<bool>}
	 * @return {Promise<void>}
	 */
	async doDateTime(settings){
		var msg = this.device.datetime(settings);
		this.connection.writeAll(msg);
	}

	/**
	 * Do DateTime Callback for MQTT
	 * @param topic Topic to send
	 * @param message Message to send {"date":<string>, "fulldayMode":<bool>}
	 * @return {Promise<void>}
	 */
	async doDateTimeCb(topic, message){
		const json = JSON.parse(message.toString())
		const settings = {
			enable: json.enable}
		if(!this.connection.isConnected()) {
			this.connection.connect().then(() => {
				new Promise((resolve, reject) => {
					resolve(this.doDateTime(settings))
				})
			})
		}else {
			new Promise((resolve, reject) => {
				resolve(this.doDateTime(settings))
			})
		}
	}

	//screen off
	/**
	 * screenOFF REST Api
	 * Getting the req params and creating settings for screenOFF
	 * @param req Request
	 * @param res Response
	 * @return {*} HTTP Status
	 * @private
	 */
	async _screenOFF(req, res) {
		const settings = {};
		if (typeof req.query.enable === 'string') {
			settings.enable = req.query.enable === 'true' ? true : false;
		}
		this.doScreenOFF(settings)
		return this._status(req, res);
	}

	/**
	 * Do screenOFF for REST Api & MQTT Api
	 * @param settings Settings to send {enable:<bool>}
	 * @return {Promise<void>}
	 */
	async doScreenOFF(settings){
		const msg = this.device.powerScreen(settings);
		this.connection.writeAll(msg);
	}

	/**
	 * Do screenOFF Callback for MQTT
	 * @param topic Topic to send
	 * @param message Message to send {"enable":<bool>}
	 * @return {Promise<void>}
	 */
	async doScreenOFFCb(topic, message){
		const json = JSON.parse(message.toString())
		const settings = {
			enable: json.enable}
		if(!this.connection.isConnected()) {
			this.connection.connect().then(() => {
				new Promise((resolve, reject) => {
					resolve(this.doScreenOFF(settings))
				})
			})
		}else {
			new Promise((resolve, reject) => {
				resolve(this.doScreenOFF(settings))
			})
		}
	}

	// Lightning

	/**
	 * Lightning REST Api
	 * Getting the req params and creating settings for Lightning
	 * @param req Request
	 * @param res Response
	 * @return {*} HTTP Status
	 * @private
	 */
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

		this.doLightning(settings)

		return this._status(req, res);
	}

	/**
	 * Do Lightning for REST Api & MQTT Api
	 * @param settings Settings to send {"color":<string>,"brightness":<int>,"mode":<int>,"powerScreen"<bool>}
	 * @return {Promise<void>}
	 */
	async doLightning(settings){
		const msg = this.device.lighting(settings);
		this.connection.writeAll(msg);
	}

	/**
	 * Do Lightning Callback for MQTT
	 * @param topic Topic to send
	 * @param message Message to send {"color":<string>,"brightness":<int>,"mode":<int>,"powerScreen"<bool>}
	 * @return {Promise<void>}
	 */
	async doLightningCb(topic, message){
		const json = JSON.parse(message.toString())
		const settings = {
			color: json.color,
			brightness: json.brightness,
			mode: json.mode,
			powerScreen: json.powerScreen}
		if(!this.connection.isConnected()) {
			this.connection.connect().then(() => {
				new Promise((resolve, reject) => {
					resolve(this.doLightning(settings))
				})
			})
		}else {
			new Promise((resolve, reject) => {
				resolve(this.doLightning(settings))
			})
		}
	}

	// Clock

	/**
	 * Clock REST Api
	 * Getting the req params and creating settings for Clock
	 * @param req Request
	 * @param res Response
	 * @return {*} HTTP Status
	 * @private
	 */
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
		this.doClock(settings)

		return this._status(req, res);
	}

	/**
	 * Do Clock for REST Api & MQTT Api
	 * @param settings Settings to send {"mode":<int>,"showTime":<bool>,"showWeather":<bool>,"showTemperature":<bool>,"showCalendar":<bool>,"color":<string>}
	 * @return {Promise<void>}
	 */
	async doClock(settings){
		const msg = this.device.clock(settings);
		this.connection.writeAll(msg);
	}

	/**
	 * Do Clock Callback for MQTT
	 * @param topic Topic to send
	 * @param message Message to send {"mode":<int>,"showTime":<bool>,"showWeather":<bool>,"showTemperature":<bool>,"showCalendar":<bool>,"color":<string>}
	 * @return {Promise<void>}
	 */
	async doClockCb(topic, message){
		const json = JSON.parse(message.toString())
		const settings = {
			mode: json.mode,
			showTime: json.showTime,
			showWeather: json.showWeather,
			showTemperature: json.showTemperature,
			showCalendar: json.showCalendar,
			color: json.color}
		if(!this.connection.isConnected()) {
			this.connection.connect().then(() => {
				new Promise((resolve, reject) => {
					resolve(this.doClock(settings))
				})
			})
		}else {
			new Promise((resolve, reject) => {
				resolve(this.doClock(settings))
			})
		}
	}

	//Status

	/**
	 * Status REST Api
	 * Getting the req params and creating settings for Status
	 * @param req Request
	 * @param res Response
	 * @return {*} HTTP Status und response
	 * @private
	 */
	_status(req, res) {
		return res.status(200).json({
			connected: this.connection.isConnected(),
			config: this.device.config
		});
	}

	/**
	 * Send Status via Mqtt to <TOPIC>/get/status
	 */
	statusCb(){
		this.sendMessage(this.mqttsettings.topic + '/get/status', this.device.config)
	}

	// Climate

	/**
	 * Climate REST Api
	 * Getting the req params and creating settings for Climate
	 * @param req Request
	 * @param res Response
	 * @return {Promise<*>} HTTP Status
	 * @private
	 */
	async _climate(req, res) {
		const settings = {};
		if (req.query.weather && parseInt(req.query.weather, 10)) {
			settings.weather = parseInt(req.query.weather, 10);
		}
		if (req.query.temperature && parseInt(req.query.temperature, 10)) {
			settings.temperature = parseInt(req.query.temperature, 10);
		}
		this.doClimate(settings)

		return this._status(req, res);
	}

	/**
	 * Do Climate for REST Api & MQTT Api
	 * @param settings Settings to send {"weather":<int>,"temperature":<int>}
	 * @return {Promise<void>}
	 */
	async doClimate(settings){
		const msg = this.device.climate(settings);
		this.connection.writeAll(msg);
	}

	/**
	 * Do Climate Callback for MQTT
	 * @param topic Topic to send
	 * @param message Message to send {"weather":<int>,"temperature":<int>}
	 * @return {Promise<void>}
	 */
	async doClimateCb(topic, message){
		const json = JSON.parse(message.toString())
		const settings = {
			weather: json.weather,
			temperature: json.temperature
		}
		if(!this.connection.isConnected()) {
			this.connection.connect().then(() => {
				new Promise((resolve, reject) => {
					resolve(this.doClimate(settings))
				})
			})
		}else {
			new Promise((resolve, reject) => {
				resolve(this.doClimate(settings))
			})
		}
	}

	// Connect

	/**
	 * Connect REST Api
	 * Getting the req params and creating settings for Connect
	 * @param req Request
	 * @param res Response
	 * @return {Promise<*>} HTTP Status
	 * @private
	 */
	async _connect(req, res) {
		this.doConnect()
		return this._status(req, res);
	}

	/**
	 * Do Effect for REST Api & MQTT Api
	 * @return {Promise<void>}
	 */
	async doConnect(){
		if (!!this.connection.isConnected() === false) {
			await this.connection.connect();
		}
	}


	//Effect

	/**
	 * Effect REST Api
	 * Getting the req params and creating settings for Effect
	 * @param req Request
	 * @param res Response
	 * @return {Promise<*>} HTTP Status
	 * @private
	 */
	async _effect(req, res) {
		const settings = {};
		if (req.query.mode && parseInt(req.query.mode, 10)) {
			settings.mode = parseInt(req.query.mode, 10);
		}

		this.doEffect(settings)

		return this._status(req, res);
	}

	/**
	 * Do Effect for REST Api & MQTT Api
	 * @param settings Settings to send {"mode":<int>}
	 * @return {Promise<void>}
	 */
	async doEffect(settings){
		const msg = this.device.effect(settings);
		this.connection.writeAll(msg);
	}

	/**
	 * Do Effect Callback for MQTT
	 * @param topic Topic to send
	 * @param message Message to send {mode:<int>}
	 * @return {Promise<void>}
	 */
	async doEffectCb(topic, message){
		const json = JSON.parse(message.toString())
		const settings = {
			mode: json.mode
		}
		if(!this.connection.isConnected()) {
			this.connection.connect().then(() => {
				new Promise((resolve, reject) => {
					resolve(this.doEffect(settings))
				})
			})
		}else {
			new Promise((resolve, reject) => {
				resolve(this.doEffect(settings))
			})
		}
	}

	// Visualization

	/**
	 * Visualization REST Api
	 * Getting the req params and creating settings for Visualization
	 * @param req Request
	 * @param res Response
	 * @return {Promise<*>} HTTP Status
	 * @private
	 */
	async _visualization(req, res) {
		const settings = {};
		if (req.query.mode && parseInt(req.query.mode, 10)) {
			settings.mode = parseInt(req.query.mode, 10);
		}

		this.doVisualization(settings)

		return this._status(req, res);
	}

	/**
	 * Do Score for REST Api & MQTT Api
	 * @param settings Settings to send {"mode":<int>}
	 * @return {Promise<void>}
	 */
	async doVisualization(settings){
		const msg = this.device.visualization(settings);
		this.connection.writeAll(msg);
	}

	/**
	 * Do Visualization Callback for MQTT
	 * @param topic Topic to send
	 * @param message Message to send {"mode":<int>}
	 * @return {Promise<void>}
	 */
	async doVisualizationCb(topic, message){
		const json = JSON.parse(message.toString())
		const settings = {
			mode: json.mode
		}
		if(!this.connection.isConnected()) {
		this.connection.connect().then(() => {
			new Promise((resolve, reject) => {
				resolve(this.doVisualization(settings))
			})
		})
		}else {
			new Promise((resolve, reject) => {
				resolve(this.doVisualization(settings))
			})
		}
	}

	// SCORE

	/**
	 * Score REST Api
	 * Getting the req params and creating settings for doScore
	 * @param req Request
	 * @param res Response
	 * @return {Promise<*>} HTTP Status
	 * @private
	 */
	async _score(req, res) {
		const settings = {};
		if (req.query.red && parseInt(req.query.red, 10)) {
			settings.red = parseInt(req.query.red, 10);
		}
		if (req.query.blue && parseInt(req.query.blue, 10)) {
			settings.blue = parseInt(req.query.blue, 10);
		}
		this.doScore(settings)

		return this._status(req, res);
	}


	/**
	 * Do Score for REST Api & MQTT Api
	 * @param settings Settings to send {"red":<int>,"blue":<int>}
	 * @return {Promise<void>}
	 */
	async doScore(settings) {
		const msg = this.device.score(settings);
		this.connection.writeAll(msg);
	}


	/**
	 * Do Score Callback for MQTT
	 * @param topic topic to send
	 * @param message Message to send  {"red":<int>,"blue":<int>}
	 * @return {Promise<void>}
	 */
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

	// SET IMG

	/**
	 * Image REST Api
	 *  Getting the req params and creating settings for doSetImg
	 * @param req Request
	 * @param res Response
	 * @return {Promise<*>} HTTP Status
	 * @private
	 */
	async _setImg(req, res) {
		const settings = {};
		if (typeof req.query.path === 'string') {
			settings.path = req.query.path;
		}
		await this.doSetImg(settings);
		return this._status(req, res);
	}

	/**
	 * Do set img for REST Api & MQTT Api
	 * @param settings Settings to send {path:<string>}
	 * @return {Promise<void>}
	 */
	async doSetImg(settings){
		await this.device.setImg(settings.path).then(result => {
			this.connection.writeImage(result.asBinaryBuffer());
		})
	}



	/**
	 * Do set img callback for MQTT
	 * @param topic Topic to send
	 * @param message Message to send {"path":<string>}
	 * @return {Promise<void>}
	 */
	async doSetImgCb(topic, message){
		console.log(message)
		 const json = JSON.parse(message.toString())
		const settings = {
		 	path: json.path
		}
		if(!this.connection.isConnected()){
			this.connection.connect().then(() => {
				new Promise((resolve, reject) => {
					resolve(this.doSetImg(settings))
				})
			})
		}else {
			new Promise((resolve, reject) => {
				resolve(this.doSetImg(settings))
			})
		}
	}

	//
	// MQTT Stuff
	//

	/**
	 * Connects to MQTT Broker and handles all mqtt trafik
	 * @param settings MQTT Settings from main.js
	 * @return {Promise<void>}
	 */
	async connect(settings) {
		// Connect mqtt with credentials (in case of needed, otherwise we can omit 2nd param)
		if(settings.username != "" && settings.pw != ""){
			this.mqttClient = mqtt.connect(settings.address, { username: settings.username, password: settings.pw});
		}else {
			this.mqttClient = mqtt.connect(settings.address);
		}
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
		const setStr = '/set/'
		const getStr = '/get/'
		const setCommands = ['score','img','visualization','effect','screenOff','climate','brightness','clock', 'status', 'connect', 'disconnect', 'lightning', 'datetime', 'fullday']
		for(let com in setCommands){
			this.mqttClient.subscribe(settings.topic + setStr + com, {qos: 0});
		}
		// When a message arrives, console.log it
		this.mqttClient.on('message', async (topic, message) => {
			console.log("TOPIC: " + topic + " MSG " + message.toString())
			switch (topic){
				case settings.topic + setStr + 'score':
					await this.doScoreCb(topic, message)
					break;
				case settings.topic + setStr + 'img':
					await this.doSetImgCb(topic, message)
					break;
				case settings.topic + setStr + 'visualization':
					await this.doVisualizationCb(topic, message)
					break;
				case settings.topic + setStr + 'effect':
					await this.doEffectCb(topic, message)
					break;
				case settings.topic + setStr + 'screenOff':
					await this.doScreenOFFCb(topic, message)
					break;
				case settings.topic + setStr + 'climate':
					await this.doClimateCb(topic, message)
					break;
				case settings.topic + setStr + 'brightness':
					await this.doBrightnessCb(topic,message)
					break;
				case settings.topic + setStr + 'clock':
					await this.doClockCb(topic, message)
					break;
				case settings.topic + setStr + 'status':
					this.statusCb()
					break;
				case settings.topic + setStr + 'connect':
					await this.doConnect()
					break;
				case settings.topic + setStr + 'fullday':
					await this.doFulldayCb(topic, message)
					break;
				case settings.topic + setStr + 'disconnect':
					await this.disconnectCb()
					break;
				case settings.topic + setStr + 'datetime':
					await this.doDateTimeCb(topic, message)
					break;
				case settings.topic + setStr + 'lightning':
					await this.doLightningCb(topic, message)
					break;
			}
		});

		this.mqttClient.on('close', () => {
			console.log(`mqtt client disconnected`);
		});
	}

	/**
	 * Sends MQTT message to current broker
	 * @param topic Send to topic
	 * @param message Send the msg
	 */
	sendMessage(topic, message) {
		this.mqttClient.publish(topic, message);
	}


}