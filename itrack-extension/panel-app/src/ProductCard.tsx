import type { Product } from "./types";

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const handleClick = () => {
    window.open(product.url, "_blank");
  };

  return (
    <article
      className="itrack-card"
      onClick={handleClick}
      data-product-id={product.id}
      data-product-name={product.name}
      data-product-url={product.url}
      data-product-price={product.price}
      data-product-kind={product.kind ?? ""}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div className="itrack-card-media">
        <img src={product.imageUrl} alt="" loading="lazy" />
      </div>
      {product.price && (
        <span className="itrack-card-price">{product.price}</span>
      )}
      <span className="itrack-card-name">{product.name}</span>
    </article>
  );
}
