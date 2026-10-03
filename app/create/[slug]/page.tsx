import Link from "next/link";
import { notFound } from "next/navigation";
import { MakerStudio } from "@/components/maker-studio";
import { Studio } from "@/components/studio";
import { productBySlug } from "@/lib/catalog";

export default async function CreatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = productBySlug(slug);
  if (!product) notFound();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-8">
      <header>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
          All models
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">{product.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">{product.summary}</p>
      </header>
      {slug === "name-keychain" ? <Studio /> : <MakerStudio key={slug} slug={slug} />}
    </main>
  );
}
