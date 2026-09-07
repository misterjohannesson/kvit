-- The credit link may only appear in the issued->credited flip, and it must point
-- at another, already issued invoice (the credit note), never at a draft or itself.
CREATE TRIGGER `invoice_credited_by_draft` BEFORE UPDATE ON `invoice` WHEN OLD.status = 'draft' AND NEW.credited_by_invoice_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'credited_by_invoice_id is set by crediting only'); END;--> statement-breakpoint
CREATE TRIGGER `invoice_credited_by_target` BEFORE UPDATE ON `invoice` WHEN OLD.status = 'issued' AND NEW.status = 'credited' AND (
  NEW.credited_by_invoice_id = NEW.id
  OR (SELECT status FROM invoice WHERE id = NEW.credited_by_invoice_id) IS NOT 'issued'
) BEGIN SELECT RAISE(ABORT, 'credited_by_invoice_id must reference an issued credit note'); END;
