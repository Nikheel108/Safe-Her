CREATE TABLE public.devices (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{3,64}$'),
  name text NOT NULL DEFAULT 'Safety wearable',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  firmware_version text
);

CREATE TABLE public.sensor_readings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id text NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  accel_x double precision NOT NULL CHECK (accel_x BETWEEN -64 AND 64),
  accel_y double precision NOT NULL CHECK (accel_y BETWEEN -64 AND 64),
  accel_z double precision NOT NULL CHECK (accel_z BETWEEN -64 AND 64),
  gyro_x double precision NOT NULL CHECK (gyro_x BETWEEN -4000 AND 4000),
  gyro_y double precision NOT NULL CHECK (gyro_y BETWEEN -4000 AND 4000),
  gyro_z double precision NOT NULL CHECK (gyro_z BETWEEN -4000 AND 4000)
);
CREATE INDEX sensor_readings_device_time ON public.sensor_readings(device_id, observed_at DESC);

CREATE TABLE public.gps_locations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id text NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m double precision CHECK (accuracy_m BETWEEN 0 AND 100000),
  satellites integer CHECK (satellites BETWEEN 0 AND 128)
);
CREATE INDEX gps_locations_device_time ON public.gps_locations(device_id, observed_at DESC);

CREATE TABLE public.activity_predictions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id text NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  label text NOT NULL CHECK (label IN ('normal','walking','running','sudden_movement','potential_fall','confirmed_emergency')),
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source text NOT NULL DEFAULT 'device'
);
CREATE INDEX activity_predictions_device_time ON public.activity_predictions(device_id, observed_at DESC);

CREATE TABLE public.emergency_events (
  id text PRIMARY KEY,
  device_id text NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('manual_sos','automatic_fall')),
  trigger_source text NOT NULL CHECK (trigger_source IN ('touch_sensor','fall_detection','other')),
  observed_at timestamptz NOT NULL,
  latitude double precision,
  longitude double precision,
  activity_label text,
  alert_status text NOT NULL DEFAULT 'queued' CHECK (alert_status IN ('queued','sent','delivered','failed','unknown')),
  resolution_status text NOT NULL DEFAULT 'active' CHECK (resolution_status IN ('active','resolved')),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
);
CREATE INDEX emergency_events_device_time ON public.emergency_events(device_id, observed_at DESC);

CREATE TABLE public.emergency_contacts (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  phone text NOT NULL,
  relationship text NOT NULL DEFAULT '',
  priority integer NOT NULL CHECK (priority BETWEEN 1 AND 20),
  active boolean NOT NULL DEFAULT true,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_primary_contact ON public.emergency_contacts(is_primary) WHERE is_primary;

CREATE TABLE public.notification_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL REFERENCES public.emergency_events(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('wifi','gsm','sms','call','unknown')),
  status text NOT NULL CHECK (status IN ('queued','sent','delivered','failed','unknown','acknowledged')),
  recipient_ref text,
  provider_ref text,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_logs_event_time ON public.notification_logs(event_id, observed_at DESC);

CREATE TABLE public.device_status (
  device_id text PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
  heartbeat_at timestamptz NOT NULL,
  wifi_status text NOT NULL DEFAULT 'unknown' CHECK (wifi_status IN ('connected','disconnected','unknown')),
  gsm_status text NOT NULL DEFAULT 'unknown' CHECK (gsm_status IN ('registered','unregistered','active','unknown')),
  communication_method text NOT NULL DEFAULT 'unknown' CHECK (communication_method IN ('wifi','gsm','offline','unknown')),
  gps_status text NOT NULL DEFAULT 'unknown' CHECK (gps_status IN ('fix','no_fix','unknown')),
  mpu6050_status text NOT NULL DEFAULT 'unknown' CHECK (mpu6050_status IN ('connected','disconnected','unknown')),
  gsm_signal integer CHECK (gsm_signal BETWEEN 0 AND 31),
  battery_percent integer CHECK (battery_percent BETWEEN 0 AND 100),
  battery_voltage double precision CHECK (battery_voltage BETWEEN 0 AND 30),
  touch_active boolean,
  buzzer_active boolean,
  red_led_active boolean
);

CREATE TABLE public.system_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id text REFERENCES public.devices(id) ON DELETE SET NULL,
  category text NOT NULL,
  event_type text NOT NULL,
  detail text NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_logs_time ON public.system_logs(observed_at DESC);

CREATE TABLE public.dashboard_sessions (
  id text PRIMARY KEY,
  expires_at bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.save_emergency_contact(
  p_id text,
  p_name text,
  p_phone text,
  p_relationship text,
  p_priority integer,
  p_active boolean,
  p_primary boolean
) RETURNS public.emergency_contacts
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE saved public.emergency_contacts;
BEGIN
  IF p_primary THEN
    UPDATE public.emergency_contacts SET is_primary = false WHERE is_primary;
  END IF;

  INSERT INTO public.emergency_contacts(name, phone, relationship, priority, active, is_primary)
  VALUES (p_name, p_phone, p_relationship, p_priority, p_active, p_primary)
  RETURNING * INTO saved;
  RETURN saved;
END;
$$;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gps_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
REVOKE ALL ON FUNCTION public.save_emergency_contact(text,text,text,text,integer,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_emergency_contact(text,text,text,text,integer,boolean,boolean) TO service_role;
