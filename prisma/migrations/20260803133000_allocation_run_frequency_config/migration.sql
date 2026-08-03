INSERT INTO "SystemConfiguration" ("id", "key", "value", "valueType", "description", "updatedAt")
VALUES (
  'cfg-booking-allocation-run-frequency',
  'booking.allocationRunFrequency',
  'WEEKLY',
  'STRING',
  'Automatic allocation run interval (weekly, biweekly, or monthly)',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
