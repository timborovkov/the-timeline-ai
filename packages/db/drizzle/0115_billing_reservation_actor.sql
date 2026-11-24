ALTER TABLE "billing_usage_reservations" ADD COLUMN "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
