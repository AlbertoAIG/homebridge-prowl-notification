var https = require('https');
var querystring = require('querystring');
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

// --- Constructor de la Plataforma ---
function ProwlNotification(log, config, api) {
    this.log = log;
    this.config = config;
    this.accessories = {}; // Inicializado como objeto para usar nombres como llaves
    this.switches = this.config.switches || [];
    
    if (api) {
        this.api = api;
        this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
    }
}

// --- Gestión de Accesorios ---

ProwlNotification.prototype.didFinishLaunching = function () {
    // Añadir o actualizar accesorios definidos en config.json
    for (var i = 0; i < this.switches.length; i++) {
        this.addAccessory(this.switches[i]);
    }
    
    // Eliminar accesorios en caché que ya no están en la configuración
    for (var name in this.accessories) {
        var accessory = this.accessories[name];
        if (!accessory.reachable) {
            this.removeAccessory(accessory);
        }
    }
}

// Configura los accesorios que Homebridge ya tiene en su base de datos (cache)
ProwlNotification.prototype.configureAccessory = function(accessory) {
    this.log("Configurando accesorio desde caché:", accessory.displayName);
    
    // Marcar como no disponible inicialmente para validarlo en didFinishLaunching
    accessory.reachable = false; 
    
    this.setService(accessory);
    var name = accessory.context.name || accessory.displayName;
    this.accessories[name] = accessory;
}

// Añade un nuevo accesorio o actualiza uno existente
ProwlNotification.prototype.addAccessory = function(data) {
    if (!data.name) {
        this.log.warn("Se encontró un switch sin nombre en la configuración. Omitiendo...");
        return;
    }

    var accessory = this.accessories[data.name];
    
    if (!accessory) {
        this.log("Añadiendo nuevo accesorio:", data.name);
        var uuid = UUIDGen.generate(data.name);
        
        // Categoría 8 es para Switches
        accessory = new Accessory(data.name, uuid, 8);
        
        accessory.addService(Service.Switch, data.name);
        this.setService(accessory);
        
        this.api.registerPlatformAccessories("homebridge-prowl-notification", "ProwlNotification", [accessory]);
        this.accessories[data.name] = accessory;
    }

    // Actualizar datos del contexto
    if (!accessory.context) accessory.context = {};
    accessory.context.name = data.name;
    accessory.context.priority = (data.priority === undefined) ? 0 : data.priority;
    accessory.context.subject = data.subject;
    accessory.context.message = data.message;

    // Marcar como alcanzable ya que está en el config.json actual
    accessory.reachable = true;

    // Actualizar Información del Accesorio
    var manufacturer = "Simone Karin Lehmann";
    var model = "Prowl Notification Switch";
    var serial = package.version || "1.0.0";
    
    accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, manufacturer)
        .setCharacteristic(Characteristic.Model, model)
        .setCharacteristic(Characteristic.SerialNumber, serial);
}

// Configura los manejadores de eventos (On/Off)
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
    this.log(thisSwitch.name + " identificado!");
    callback();
}

ProwlNotification.prototype.removeAccessory = function (accessory) {
    if (accessory) {
        this.log("Eliminando accesorio antiguo:", accessory.displayName);
        this.api.unregisterPlatformAccessories("homebridge-prowl-notification", "ProwlNotification", [accessory]);
        delete this.accessories[accessory.context.name];
    }
}

// --- Lógica del Switch ---

ProwlNotification.prototype.getState = function (thisSwitch, callback) {
    // El switch siempre vuelve a "Off", así que devolvemos false
    callback(null, false);
}

ProwlNotification.prototype.setState = function (thisSwitch, state, callback) {
    var self = this;

    if (state === true) {
        this.log("Switch activado: Enviando notificación Prowl...");
        
        // Auto-apagado tras 3 segundos para que sea un pulsador
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

// --- Envío de Notificación ---

ProwlNotification.prototype.sendNotification = function(thisSwitch) {
    var defaultMessage = (this.config.defaultmsg === undefined) ? "%s has been triggered." : this.config.defaultmsg;
    
    // Prioridad: 1. Config específica del switch | 2. Nombre del switch
    var subject = thisSwitch.subject || thisSwitch.name;
    var message = thisSwitch.message || format(defaultMessage, subject);

    var data = querystring.stringify({ 
        apikey: this.config.apikey,
        application: subject,
        description: message,
        priority: thisSwitch.priority
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
        this.log.debug(`Respuesta de Prowl (Status: ${res.statusCode})`);
    });
    
    req.on('error', error => {
        this.log.error("Error enviando notificación a Prowl: " + error);
    });
    
    req.write(data);
    req.end();
}
