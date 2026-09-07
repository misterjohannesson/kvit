-- Tighten the invoice immutability trigger: status must be one of the three known
-- values, a credited invoice can never go back to issued, and a draft can only
-- ever become issued.
DROP TRIGGER IF EXISTS `invoice_immutable_issued`;--> statement-breakpoint
CREATE TRIGGER `invoice_immutable_issued` BEFORE UPDATE ON `invoice` WHEN OLD.status <> 'draft' AND (
  NEW.invoice_number IS NOT OLD.invoice_number OR NEW.customer_id <> OLD.customer_id OR NEW.issue_date <> OLD.issue_date
  OR NEW.due_date <> OLD.due_date OR NEW.currency <> OLD.currency OR NEW.subtotal_ore <> OLD.subtotal_ore
  OR NEW.vat_ore <> OLD.vat_ore OR NEW.total_ore <> OLD.total_ore OR NEW.vat_rate_bp <> OLD.vat_rate_bp
  OR NEW.vat_exempt_reason IS NOT OLD.vat_exempt_reason OR NEW.payment_reference <> OLD.payment_reference
  OR NEW.pdf_path IS NOT OLD.pdf_path OR NEW.created_at <> OLD.created_at
  OR NEW.status NOT IN ('issued', 'credited')
  OR (OLD.status = 'credited' AND NEW.status <> 'credited')
  OR (OLD.status = 'issued' AND NEW.status = 'credited' AND NEW.credited_by_invoice_id IS NULL)
) BEGIN SELECT RAISE(ABORT, 'issued invoices are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_status_values_insert` BEFORE INSERT ON `invoice` WHEN NEW.status NOT IN ('draft', 'issued', 'credited') BEGIN SELECT RAISE(ABORT, 'invalid invoice status'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_status_values_update` BEFORE UPDATE ON `invoice` WHEN NEW.status NOT IN ('draft', 'issued', 'credited') OR (OLD.status = 'draft' AND NEW.status = 'credited') BEGIN SELECT RAISE(ABORT, 'invalid invoice status transition'); END;
