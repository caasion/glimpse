import ProductCard from "./ProductCard";
import type { Product } from "./types";

interface SectionRowProps {
  title: string;
  products: Product[];
}

export default function SectionRow({ title, products }: SectionRowProps) {
  return (
    <section className="itrack-section-row">
      <h1 className="itrack-section-title">{title}</h1>
      <div className="itrack-cards-row">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
