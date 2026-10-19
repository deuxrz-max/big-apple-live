export function giftMediaUrl(url: string): string {
  if (/^(https?:)?\/\//i.test(url)) return url;
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${url.replace(/^\/+/, "")}`;
}
