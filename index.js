var https = require('https');
var querystring = require('querystring');
var fs = require('fs');
var format = require("util").format;
var package = require("./package.json");
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    
    homebridge.registerPlatform("homebridge-prowl-notification", "ProwlNotification", ProwlNotification, true);
}

function ProwlNotification(log, config, api) {
    this.log = log;
    this.config = config;
    // CORRECCIÓN: Inicializar como objeto para usar nombres como llaves
    this.accessories = {}; 
    this.switches = this.config.switches || [];
    
    if (api) {
        this.api = api;
        this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
    }
}

ProwlNotification.prototype.didFinishLaunching = function () {
    // Añadir o actualizar accesorios
    for (var i = 0; i < this.switches.length; i++) {
        this.addAccessory(this.switches[i]);
    }
    
    // Eliminar accesorios antiguos que ya no están en el config
    for (var name in this.accessories) {
        var accessory = this.accessories[name];
        if (!accessory.reachable) this.removeAccessory(accessory);
    }
}

ProwlNotification.prototype.configureAccessory = function(accessory) {
    this.log("Configure cached accessory:", accessory.displayName);
    var name = accessory.context.name || accessory.displayName;
    
    this.setService(accessory);
    this.accessories[name] = accessory;
}

ProwlNotification.prototype.addAccessory = function(data) {
    if (!data.name) {
        this.log.warn("Accesorio omitido: No tiene nombre definido en el config.");
        return;
    }

    var accessory = this.accessories[data.name];
    
    if (!accessory) {
        this.log("Add new accessory:", data.name);
        var uuid = UUIDGen.generate(data.name);
        accessory = new Accessory(data.name, uuid, 8); // 8 = Switch
        
        accessory.addService(Service.Switch, data.name);
        this.setService(accessory);
        
        this.api.registerPlatformAccessories("homebridge-prowl-notification", "ProwlNotification", [accessory]);
        this.accessories[data.name] = accessory;
    }

    // Asegurar que context existe antes de asignar
    if (!accessory.context) accessory.context = {};
    
    accessory.context.name = data.name;
    accessory.context.priority = (data.priority === undefined) ? 0 : data.priority;

    var manufacturer = "Simone Karin Lehmann";
    var model = "Prowl Notification Switch";
    var serial = package.version || "1.0.0";
    
    accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, manufacturer)
        .setCharacteristic(Characteristic.Model, model)
        .setCharacteristic(Characteristic.SerialNumber, serial);
    
    accessory.updateReachability(true);
}

ProwlNotification.prototype.setService = function (accessory) {
    var service = accessory.getService(Service.Switch);
    if (service) {
        service.getCharacteristic(Characteristic.On)
            .on('get', this.getState.bind(this, accessory.context))
            .on('set', this.setState.bind(this, accessory.context));
    }
    
    accessory.on('identify', this.identify.bind(this, accessory.context));
}

ProwlNotification.prototype.identify = function (thisSwitch, paired, callback) {
    this.log(thisSwitch.name + " identify requested!");
    callback();
}

ProwlNotification.prototype.removeAccessory = function (accessory) {
    if (accessory) {
        var name = accessory.context.name;
        this.api.unregisterPlatformAccessories("homebridge-prowl-notification", "ProwlNotification", [accessory]);
        delete this.accessories[name];
    }
}

ProwlNotification.prototype.getState = function (thisSwitch, callback) {
    callback(null, false);
}

ProwlNotification.prototype.setState = function (thisSwitch, state, callback) {
    var self = this;

    if (state === true) {
        setTimeout(function () {
            var acc = self.accessories[thisSwitch.name];
            if (acc) {
                acc.getService(Service.Switch).setCharacteristic(Characteristic.On, false);
            }
        }, 3000);
        this.sendNotification(thisSwitch);
    }
    callback(null);
}

ProwlNotification.prototype.sendNotification = function(thisSwitch) {
    this.log.debug("send notification from " + thisSwitch.name);

    var defaultMessage = (this.config.defaultmsg === undefined) ? "%s has been triggered." : this.config.defaultmsg;
    var subject = thisSwitch.name;
    var message = format(defaultMessage, subject);

    // Buscar si hay sobreescritura específica en el config de este switch
    if (this.switches) {
        for (var i = 0; i < this.switches.length; i++) {
            if (this.switches[i].name === thisSwitch.name) {
                if (this.switches[i].subject) subject = this.switches[i].subject;
                if (this.switches[i].message) message = this.switches[i].message;
                break;
            }
        }
    }

    var data = querystring.stringify({ 
        apikey : this.config.apikey,
        application : subject,
        description : message,
        priority : thisSwitch.priority
    });
    
    var options = {
        hostname: 'api.prowlapp.com',
        port: 443,
        path: '/publicapi/add',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': data.length
        }
    };
    
    var req = https.request(options, res => {
        this.log.debug(`sendNotification statusCode: ${res.statusCode}`);
    });
    
    req.on('error', error => {
        this.log.error("sendNotification: " + error);
    });
    
    req.write(data);
    req.end();
}
