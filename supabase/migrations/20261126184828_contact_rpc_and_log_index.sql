CREATE INDEX IF NOT EXISTS system_logs_device_time ON public.system_logs(device_id, observed_at DESC);

DROP FUNCTION IF EXISTS public.save_emergency_contact(text,text,text,text,integer,boolean,boolean);
CREATE OR REPLACE FUNCTION public.save_emergency_contact(
  p_id text,
  p_name text,
  p_phone text,
  p_relationship text,
  p_priority integer,
  p_active boolean,
  p_primary boolean,
  p_update boolean
) RETURNS public.emergency_contacts
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE saved public.emergency_contacts;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'contact id is required';
  ELSIF p_primary THEN
    UPDATE public.emergency_contacts SET is_primary = false WHERE is_primary;
  END IF;

  IF p_update THEN
    UPDATE public.emergency_contacts
    SET name = p_name, phone = p_phone, relationship = p_relationship,
        priority = p_priority, active = p_active, is_primary = p_primary, updated_at = now()
    WHERE id = p_id
    RETURNING * INTO saved;
  ELSE
    INSERT INTO public.emergency_contacts(id, name, phone, relationship, priority, active, is_primary)
    VALUES (p_id, p_name, p_phone, p_relationship, p_priority, p_active, p_primary)
    RETURNING * INTO saved;
  END IF;

  IF saved.id IS NULL THEN
    RAISE EXCEPTION 'contact not found';
  END IF;
  RETURN saved;
END;
$$;

REVOKE ALL ON FUNCTION public.save_emergency_contact(text,text,text,text,integer,boolean,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_emergency_contact(text,text,text,text,integer,boolean,boolean,boolean) TO service_role;
