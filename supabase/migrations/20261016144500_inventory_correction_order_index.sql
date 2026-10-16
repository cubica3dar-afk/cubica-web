-- Cover the private audit table foreign key used when reconciling a correction
-- back to its order. Direct access remains revoked and RLS remains enabled.
create index if not exists inventory_movement_corrections_order
  on private.inventory_movement_corrections(order_id);
