import aedesFactory from 'aedes'
import bcrypt from 'bcryptjs'
import net from 'node:net'
import tls from 'node:tls'
import fs from 'node:fs'
import { db } from './db.js'
import { config } from './config.js'
import { evaluateAutomaticControl } from './automation.js'

export const broker=aedesFactory({id:'lumacurtain-broker'})
const topic=(deviceId,suffix)=>`lumacurtain/${deviceId}/${suffix}`
const failedAuth=new Map()
function authBlocked(address){const state=failedAuth.get(address);if(!state)return false;if(Date.now()-state.since>60000){failedAuth.delete(address);return false}return state.count>=8}
function recordFailure(address){const state=failedAuth.get(address);failedAuth.set(address,!state||Date.now()-state.since>60000?{count:1,since:Date.now()}:{...state,count:state.count+1})}

broker.authenticate=async(client,usernameBuffer,passwordBuffer,done)=>{
  try{
    const address=client?.conn?.remoteAddress||'unknown';if(authBlocked(address))return done(null,false)
    const username=usernameBuffer?.toString().trim().toUpperCase(); const password=passwordBuffer?.toString()||''
    if(!username||!password){recordFailure(address);return done(null,false)}
    const [rows]=await db.execute('SELECT device_id,mqtt_password_hash FROM devices WHERE device_id=? LIMIT 1',[username])
    const device=rows[0]; const valid=device&&await bcrypt.compare(password,device.mqtt_password_hash)
    if(!valid){recordFailure(address);return done(null,false)}
    failedAuth.delete(address);client.deviceId=device.device_id; done(null,true)
  }catch(error){done(error,false)}
}
broker.authorizePublish=(client,packet,done)=>{
  if(!client?.deviceId)return done(new Error('MQTT publish ditolak.'))
  const allowed=[topic(client.deviceId,'telemetry'),topic(client.deviceId,'heartbeat'),topic(client.deviceId,'status')]
  done(allowed.includes(packet.topic)?null:new Error('Topic publish tidak diizinkan.'))
}
broker.authorizeSubscribe=(client,subscription,done)=>{
  if(client?.deviceId&&subscription.topic===topic(client.deviceId,'command'))return done(null,subscription)
  done(new Error('Topic subscribe tidak diizinkan.'))
}
broker.on('publish',async(packet,client)=>{
  if(!client?.deviceId)return
  try{
    const body=JSON.parse(packet.payload.toString()); const now=new Date()
    if(packet.topic===topic(client.deviceId,'heartbeat')){
      await db.execute('UPDATE devices SET last_seen_at=?,firmware_version=LEFT(?,40) WHERE device_id=?',[now,String(body.firmwareVersion||''),client.deviceId]);return
    }
    if(packet.topic===topic(client.deviceId,'telemetry')){
      const light=body.light==null?null:Number(body.light); const distance=body.distanceCm==null?null:Number(body.distanceCm)
      const position=['open','closed','between','unknown'].includes(body.position)?body.position:'unknown'
      if((light!==null&&(!Number.isFinite(light)||light<0||light>4095))||(distance!==null&&(!Number.isFinite(distance)||distance<0||distance>1000)))return
      const [devices]=await db.execute('SELECT id,owner_id FROM devices WHERE device_id=? LIMIT 1',[client.deviceId]); const device=devices[0]
      await db.execute('UPDATE devices SET last_seen_at=? WHERE id=?',[now,device.id])
      if(device.owner_id){
        await db.execute('INSERT INTO sensor_readings(id,owner_id,device_id,reading_at,light,distance_cm,position,moving,limit_open,limit_closed,source) VALUES(UUID(),?,?,?,?,?,?,?,?,?,\\'esp32\\')',[device.owner_id,device.id,now,light,distance,position,body.moving===true,body.limitOpen===true,body.limitClosed===true])
        await evaluateAutomaticControl({deviceId:client.deviceId,light,position,moving:body.moving===true,publishCommand})
      }
    }
  }catch(error){console.error('Payload MQTT diabaikan:',error.message)}
})
export function publishCommand(deviceId,payload){return new Promise((resolve,reject)=>broker.publish({topic:topic(deviceId,'command'),payload:Buffer.from(JSON.stringify(payload)),qos:1,retain:false},error=>error?reject(error):resolve()))}
export function startMqtt(){
  const useTls=config.MQTT_TLS_CERT_PATH&&config.MQTT_TLS_KEY_PATH
  const server=useTls?tls.createServer({cert:fs.readFileSync(config.MQTT_TLS_CERT_PATH),key:fs.readFileSync(config.MQTT_TLS_KEY_PATH)},broker.handle):net.createServer(broker.handle)
  server.listen(config.MQTT_PORT,config.MQTT_HOST,()=>console.log(`MQTT ${useTls?'TLS ':''}aktif di ${config.MQTT_HOST}:${config.MQTT_PORT}`));return server
}
