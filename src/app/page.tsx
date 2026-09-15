import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
      }}
    >
      <h1>Pomodoro Project</h1>
      <Link
        href="/hair-test"
        style={{
          padding: "10px 18px",
          borderRadius: 8,
          background: "#3b82f6",
          color: "white",
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        3D Hair Painting Prototype 열기
      </Link>
    </main>
  );
}
