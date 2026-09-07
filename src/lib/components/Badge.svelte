<script lang="ts">
  import { invoiceStatus } from '$lib/format';
  let {
    invoice,
    today
  }: {
    invoice: { status: string; dueDate: string; paidDate: string | null; isCreditNote?: boolean };
    today?: string;
  } = $props();
  const st = $derived(invoiceStatus(invoice, today));
</script>

<span class="badge {st.cls}">{st.label}</span>{#if st.overdueDays}<span class="badge-note">+{st.overdueDays} dage</span>{/if}
