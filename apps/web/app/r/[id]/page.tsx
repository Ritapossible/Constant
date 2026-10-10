import { Receipt } from "@/components/app/Receipt";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Receipt id={id} />;
}
