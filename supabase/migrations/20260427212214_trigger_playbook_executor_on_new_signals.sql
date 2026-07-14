
-- Trigger the playbook executor whenever a new adverse_signal is inserted
CREATE OR REPLACE FUNCTION trigger_playbook_execution_for_new_signal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_get(
    url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/playbook-executor/process-signal?signal_id=' || NEW.id || '&secret=3i_6DdFRT-EmxT0nczskfeA3HshAnu64w40C9-WmkAE',
    timeout_milliseconds := 10000
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS adverse_signal_to_playbook ON adverse_signals;

CREATE TRIGGER adverse_signal_to_playbook
AFTER INSERT ON adverse_signals
FOR EACH ROW
EXECUTE FUNCTION trigger_playbook_execution_for_new_signal();
