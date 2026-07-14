
-- Drop existing trigger if any, then create fresh
DROP TRIGGER IF EXISTS nurture_on_lock_view ON events;

CREATE TRIGGER nurture_on_lock_view
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION trigger_nurture_on_lock();
