import { notFoundUnlessWorkItemId } from '@/lib/work-item-id';

export default async function WorkItemIdLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await notFoundUnlessWorkItemId(params);
  return children;
}
