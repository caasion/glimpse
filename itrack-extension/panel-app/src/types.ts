export interface Product {
  id: string;
  name: string;
  shortDescription?: string;
  imageUrl: string;
  price: string;
  url: string;
  kind?: string;
}

export interface PanelData {
  recommended: Product[];
  all: Product[];
}

declare global {
  interface Window {
    __ITRACK_PANEL_DATA__?: PanelData;
  }
}
