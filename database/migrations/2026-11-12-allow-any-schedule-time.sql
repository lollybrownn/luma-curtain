-- Jalankan sekali pada database LumaCurtain yang sudah pernah dibuat.
-- Mengizinkan jadwal buka dan tutup berada pada jam berapa pun.
ALTER TABLE curtain_settings DROP CHECK chk_open_time;
ALTER TABLE curtain_settings DROP CHECK chk_close_time;
