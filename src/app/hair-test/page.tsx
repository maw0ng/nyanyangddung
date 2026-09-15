import dynamic from "next/dynamic";

const HairPaintPrototype = dynamic(
  () => import("@/components/hair-prototype/HairPaintPrototype"),
  { ssr: false }
);

export default function HairTestPage() {
  return <HairPaintPrototype />;
}
