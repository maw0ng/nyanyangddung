import dynamic from "next/dynamic";

const FriendsApp = dynamic(() => import("@/components/friends/FriendsApp"), { ssr: false });

export default function FriendsPage() {
  return <FriendsApp />;
}
