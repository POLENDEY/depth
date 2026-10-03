import Link from "next/link";
import { ProductArt } from "@/components/product-art";
import { PRODUCTS } from "@/lib/catalog";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-[0.18em] text-zinc-800">START CREATING</h1>
        <p className="mt-2 text-sm text-zinc-500">Customize 3D print models directly in your browser</p>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PRODUCTS.map((product) => (
          <Link
            key={product.slug}
            href={`/create/${product.slug}`}
            className="group relative overflow-hidden rounded-2xl bg-zinc-200 shadow-sm ring-1 ring-black/5 transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="aspect-[4/3]">
              <ProductArt slug={product.slug} />
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-3 pt-12 pb-3">
              <p className="text-center text-sm font-medium tracking-[0.16em] text-white">
                {product.title.toUpperCase()}
              </p>
              <span
                className="mt-2 flex h-10 items-center justify-center rounded-md text-sm font-semibold tracking-[0.14em] text-white"
                style={{ background: product.button }}
              >
                CUSTOMIZE
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
