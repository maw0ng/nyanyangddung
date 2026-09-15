import dynamic from "next/dynamic";

const CoWorkApp = dynamic(() => import("@/components/cowork/CoWorkApp"), { ssr: false });

export default function CoWorkPage() {
  return <CoWorkApp />;
}
