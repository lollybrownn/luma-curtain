import { z } from 'zod'
export const credentials=z.object({email:z.string().email().max(191).transform(v=>v.toLowerCase()),password:z.string().min(8).max(72)})
export const registration=credentials.extend({name:z.string().trim().min(2).max(80)})
export const pairing=z.object({deviceId:z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9:_-]{5,63}$/),pairingCode:z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8,16}$/)})
export const command=z.object({target:z.coerce.number().int().min(0).max(100)})
export const settings=z.object({deviceName:z.string().trim().min(2).max(80),mode:z.enum(['auto','manual']),openTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).refine(v=>v<='12:00','Jadwal buka maksimal 12:00'),closeTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).refine(v=>v>='12:00','Jadwal tutup minimal 12:00'),lightThreshold:z.coerce.number().int().min(0).max(4095)})
export function validate(schema){return(req,res,next)=>{const result=schema.safeParse(req.body);if(!result.success)return res.status(400).json({error:result.error.issues[0]?.message||'Data tidak valid.'});req.validated=result.data;next()}}
