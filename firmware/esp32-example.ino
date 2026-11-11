#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// Salin nilai dari `npm run provision:device`. Jangan commit firmware berisi rahasia.
const char* WIFI_SSID = "GANTI_WIFI";
const char* WIFI_PASSWORD = "GANTI_PASSWORD_WIFI";
const char* MQTT_HOST = "192.168.1.10"; // IP komputer server
const uint16_t MQTT_PORT = 1883; // Gunakan 8883 + WiFiClientSecure untuk produksi TLS
const char* DEVICE_ID = "LUMA-GANTI";
const char* MQTT_PASSWORD = "GANTI_PASSWORD_MQTT";

WiFiClient network;
PubSubClient mqtt(network);
String commandTopic;
String telemetryTopic;
String heartbeatTopic;

void onMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  if (doc["type"] == "set_position") {
    int target = constrain(doc["target"] | 0, 0, 100);
    // TODO: gerakkan motor ke target dengan limit switch dan proteksi keselamatan.
    Serial.printf("Target baru: %d%%\n", target);
  }
}

void connectMqtt() {
  while (!mqtt.connected()) {
    uint64_t chip = ESP.getEfuseMac();
    String clientId = "luma-" + String((uint32_t)(chip >> 32), HEX) + String((uint32_t)chip, HEX);
    // Client ID bukan rahasia. Keamanan berasal dari username/password acak dan ACL topic.
    if (mqtt.connect(clientId.c_str(), DEVICE_ID, MQTT_PASSWORD)) {
      mqtt.subscribe(commandTopic.c_str(), 1);
    } else {
      delay(3000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  commandTopic = "lumacurtain/" + String(DEVICE_ID) + "/command";
  telemetryTopic = "lumacurtain/" + String(DEVICE_ID) + "/telemetry";
  heartbeatTopic = "lumacurtain/" + String(DEVICE_ID) + "/heartbeat";
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);
}

unsigned long lastPublish = 0;
void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();
  if (millis() - lastPublish > 15000) {
    lastPublish = millis();
    JsonDocument telemetry;
    telemetry["light"] = analogRead(34);
    telemetry["distanceCm"] = 0; // TODO: isi hasil sensor ultrasonik
    telemetry["position"] = "unknown";
    telemetry["moving"] = false;
    telemetry["limitOpen"] = false;
    telemetry["limitClosed"] = false;
    char output[384];
    serializeJson(telemetry, output);
    mqtt.publish(telemetryTopic.c_str(), output, false);

    JsonDocument heartbeat;
    heartbeat["firmwareVersion"] = "1.0.0";
    serializeJson(heartbeat, output);
    mqtt.publish(heartbeatTopic.c_str(), output, false);
  }
}
