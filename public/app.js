const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const money = (value) => `LKR ${Number(value || 0).toLocaleString('en-LK')}`;
const formatDate = (value) => value ? new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('en-LK',{day:'numeric',month:'short',year:'numeric'}) : 'To be confirmed';
const imageFallback = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=75';
let categories = [
  { name:'Electronics', icon:'🎧', color:'#e1f0ff', copy:'Everyday tech' }, { name:'Fashion', icon:'🧢', color:'#ffeadf', copy:'Style & essentials' },
  { name:'Home', icon:'🏠', color:'#e6f6e9', copy:'Make it yours' }, { name:'Lifestyle', icon:'🎒', color:'#f0e8ff', copy:'Carry your day' },
  { name:'Beauty', icon:'✨', color:'#ffe9f1', copy:'Little rituals' }, { name:'Sports', icon:'⚽', color:'#e3f7f4', copy:'Move your way' },
  { name:'Accessories', icon:'⌚', color:'#fff4d6', copy:'Finishing touches' }, { name:'Mobiles', icon:'📱', color:'#e8edff', copy:'Stay connected' }
];
let storeConfig = { currency:'LKR', freeShippingThreshold:15000, defaultDeliveryFee:450 };
let firebaseService = null;
let currentUser = null;
let allProducts = [];
let cart = JSON.parse(localStorage.getItem('exora_cart') || '[]').filter((x) => Number.isSafeInteger(Number(x.id)) && Number(x.quantity) > 0);
let cartSyncTimer = 0;
let wishlist = JSON.parse(localStorage.getItem('exora_wishlist') || '[]').map(Number).filter(Number.isSafeInteger);
let lastOrder = null;
let activeProduct = null;
let selectedImages = [];
let toastTimer = 0;
let searchDebounce = 0;
let lastFirebaseError = '';
let searchSuggestionSequence = 0;
let shopQuerySequence = 0;
let shopOffset = 0;
let shopTotal = 0;
let shopCriteria = '';
let shopResults = [];
let shopLoading = false;

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, headers, credentials:'same-origin' });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error || 'The request could not be completed.');
  return data;
}
function toast(message) { const node = $('#toast'); if (!node) return; node.textContent = message; node.classList.add('visible'); window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => node.classList.remove('visible'), 2900); }
function setCookie(name, value, days) { document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${days * 86400}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; }
function getCookie(name) { const match = document.cookie.split('; ').find((item) => item.startsWith(`${name}=`)); return match ? decodeURIComponent(match.slice(name.length + 1)) : ''; }
function cleanLegacySession() { localStorage.removeItem('exora_token'); }
function persistCart() { localStorage.setItem('exora_cart', JSON.stringify(cart)); updateCartBadges(); if(currentUser?.role==='customer'){window.clearTimeout(cartSyncTimer);cartSyncTimer=window.setTimeout(()=>api('/api/account/cart',{method:'PUT',body:JSON.stringify({items:cart.map(({id,quantity,variant})=>({id,quantity,variant:variant||''}))})}).catch((error)=>console.warn('Cart sync will retry next time you sign in:',error.message)),250);} }
function persistWishlist() { localStorage.setItem('exora_wishlist', JSON.stringify([...new Set(wishlist)])); updateWishlistHearts(); }
function updateCartBadges() { const count = cart.reduce((n, item) => n + Number(item.quantity), 0); $$('#cart-count,.mobile-nav-badge').forEach((node) => { if (node.id === 'cart-count') node.textContent = count; }); $$('[data-cart-count]').forEach((node) => node.textContent = count); }
function updateWishlistHearts() { $$('.heart-button').forEach((btn) => { const on = wishlist.includes(Number(btn.dataset.wish)); btn.classList.toggle('is-active',on); btn.textContent = on ? '♥' : '♡'; btn.setAttribute('aria-label',on?'Remove from wishlist':'Add to wishlist'); }); }
function currentPage() { return document.body.dataset.page || 'home'; }
function productHref(p) { return `/product.html?id=${encodeURIComponent(p.id)}`; }
function discountPercent(p) { return p.compare_at_price && p.compare_at_price > p.price ? Math.round((1 - p.price / p.compare_at_price) * 100) : 0; }
function stars(p) { return p.review_count ? `★ ${Number(p.rating || 0).toFixed(1)} <span>(${p.review_count})</span>` : `☆ <span>No reviews</span>`; }
function productCard(p) {
  const discount = discountPercent(p); const image = p.image_url || (p.image_urls || [])[0] || imageFallback;
  return `<article class="product-card"><a class="product-image-wrap" href="${productHref(p)}" aria-label="View ${esc(p.name)}"><img src="${esc(image)}" alt="${esc(p.name)}" loading="lazy" onerror="this.onerror=null;this.src='${imageFallback}'">${discount ? `<span class="product-discount">-${discount}%</span>` : ''}${p.flash_sale ? '<span class="product-badge">⚡ FLASH</span>' : p.featured ? '<span class="product-badge">PICKED</span>' : ''}<button class="heart-button ${wishlist.includes(Number(p.id))?'is-active':''}" data-wish="${p.id}" type="button" aria-label="Add to wishlist">${wishlist.includes(Number(p.id))?'♥':'♡'}</button></a><div class="product-details"><div class="product-vendor"><span>${esc(p.seller_name || 'Exora Direct')}</span><span class="sold-count">${Number(p.sold_count || 0)} sold</span></div><a class="product-title" href="${productHref(p)}">${esc(p.name)}</a><div class="product-rating">${stars(p)}</div><div class="product-price-row"><strong class="product-price">${money(p.price)}</strong>${p.compare_at_price && p.compare_at_price>p.price ? `<span class="product-old-price">${money(p.compare_at_price)}</span>` : ''}</div>${discount ? `<div class="product-saved">Save ${money(p.compare_at_price - p.price)}</div>` : ''}<div class="stock-note ${p.stock>0 && p.stock<6?'low':''}">${p.stock>0 ? (p.stock<6 ? `Only ${p.stock} left` : `Delivery in ${p.delivery_min_days || 2}–${p.delivery_max_days || 5} days`) : 'Out of stock'}</div></div><div class="product-card-foot"><button class="add-button add-to-cart" data-add="${p.id}" type="button" ${p.stock<1?'disabled':''}>${p.stock<1?'Sold out':'＋ Add to cart'}</button><button class="mini-icon-button quick-view" data-quick="${p.id}" type="button" title="Quick view" aria-label="Quick view">↗</button></div></article>`;
}
function renderGrid(element, products, emptyElement = null) {
  if (!element) return;
  element.innerHTML = products.length ? products.map(productCard).join('') : '';
  if (emptyElement) emptyElement.classList.toggle('hidden', products.length > 0);
  updateWishlistHearts();
}
function renderCategoryCards(element, large = false) {
  if (!element) return;
  element.innerHTML = categories.map((c) => {
    const count = allProducts.filter((p) => p.category.toLowerCase() === c.name.toLowerCase()).length;
    return `<a class="category-card" href="/shop.html?category=${encodeURIComponent(c.name)}"><div class="category-art" style="background:${c.color}">${c.icon}</div><strong>${esc(c.name)}</strong><small>${count} ${count === 1 ? 'product' : 'products'}</small></a>`;
  }).join('');
}
function shell() {
  const header = $('#app-header');
  if (header) header.innerHTML = `<div class="announcement"><span class="announcement-dot"></span><span>Exora Sri Lanka · Discover the deals that move with you</span><span class="announcement-sep">•</span><a href="/deals.html">Flash offers live ↗</a></div><div class="site-topbar"><div class="page-wrap header-main"><a class="brand" href="/" aria-label="Exora home"><span class="brand-mark">e<i>✳</i></span><span><span class="brand-word">exo<span>ra.</span></span><small class="brand-caption">SHOP YOUR WAY</small></span></a><form class="search-wrap" id="global-search-form" role="search"><span class="search-symbol">⌕</span><input type="search" id="global-search" autocomplete="off" placeholder="Search products, categories, sellers…" aria-label="Search products"><button class="search-submit" type="submit">Search</button><div class="search-suggestions" id="search-suggestions"></div></form><nav class="header-actions"><a class="header-action" href="/account.html"><span class="head-icon">♙</span><span class="action-copy"><strong id="header-account-label">Sign in</strong><small>My account</small></span></a><a class="header-action" href="/wishlist.html"><span class="head-icon">♡</span><span class="action-copy"><strong>Wishlist</strong><small>Saved picks</small></span></a><button class="header-action" id="header-cart-button" type="button"><span class="head-icon">🛒</span><span class="action-copy"><strong>Cart</strong><small>My bag</small></span><b id="cart-count" class="count-badge">0</b></button></nav></div><nav class="category-nav"><div class="page-wrap category-nav-inner"><a href="/shop.html" class="${currentPage()==='shop'?'active':''}">All products</a><a href="/categories.html">Categories</a><a class="nav-hot" href="/deals.html">⚡ Flash deals</a><a href="/shop.html?category=Electronics">Electronics</a><a href="/shop.html?category=Fashion">Fashion</a><a href="/shop.html?category=Home">Home & Living</a><a href="/shop.html?category=Mobiles">Mobiles</a><a href="/businesses.html">Marketplace sellers</a></div></nav></div>`;
  const footer = $('#app-footer');
  if (footer) footer.innerHTML = `<footer class="site-footer"><div class="page-wrap footer-main"><a class="brand brand-footer" href="/"><span class="brand-mark">e<i>✳</i></span><span><span class="brand-word">exo<span>ra.</span></span><small class="brand-caption">SHOP YOUR WAY</small></span></a><p>Trending finds, independent sellers and everyday essentials — in one Sri Lankan shopping experience.</p><nav class="footer-links"><a href="/shop.html">Shop</a><a href="/businesses.html">Sellers</a><a href="/info.html?section=shipping">Delivery</a><a href="/info.html?section=returns">Returns</a><a href="/info.html?section=faq">FAQ</a><a href="/info.html?section=privacy">Privacy</a><a href="/info.html?section=terms">Terms</a><a href="mailto:${esc(storeConfig.supportEmail || 'support@example.com')}">Contact</a></nav></div><div class="page-wrap footer-bottom"><span>© ${new Date().getFullYear()} Exora. All rights reserved.</span><span>Made for Sri Lanka <b>✳</b></span><span>Prices in LKR · Secure account session</span></div></footer>`;
  const mobile = $('#mobile-nav');
  if (mobile) mobile.innerHTML = `<nav class="mobile-bottom-nav" aria-label="Mobile app navigation"><a class="mobile-nav-link ${currentPage()==='home'?'active':''}" href="/"><span>⌂</span><span>Home</span></a><a class="mobile-nav-link ${['shop','categories','deals'].includes(currentPage())?'active':''}" href="/categories.html"><span>▦</span><span>Explore</span></a><button class="mobile-nav-link" id="mobile-cart-button" type="button"><span>🛒</span><span>Cart</span><b data-cart-count class="mobile-nav-badge">0</b></button><a class="mobile-nav-link ${currentPage()==='orders'?'active':''}" href="/orders.html"><span>▣</span><span>Orders</span></a><a class="mobile-nav-link ${['account','wishlist'].includes(currentPage())?'active':''}" href="/account.html"><span>♙</span><span>Profile</span></a></nav>`;
  const modal = $('#global-modal'); if (modal && !modal.innerHTML) modal.innerHTML = '';
  const cookie = $('#cookie-banner');
  if (cookie && !getCookie('exora_cookie_choice')) cookie.innerHTML = `<section class="cookie-banner visible"><strong>Cookies, your way 🍪</strong><p>Exora uses essential session cookies to keep sign-in secure and local storage to remember your cart and preferences. Account and order information is kept in the store database, not in a readable password cookie.</p><div class="cookie-actions"><button id="cookie-accept" type="button">Accept essential cookies</button><button id="cookie-dismiss" type="button">Not now</button></div></section>`;
  $('#cookie-accept')?.addEventListener('click', () => { setCookie('exora_cookie_choice','accepted',180); $('.cookie-banner')?.classList.remove('visible'); });
  $('#cookie-dismiss')?.addEventListener('click', () => { setCookie('exora_cookie_choice','dismissed',7); $('.cookie-banner')?.classList.remove('visible'); });
  $('#global-search-form')?.addEventListener('submit', (event) => { event.preventDefault(); const q = $('#global-search').value.trim(); location.href = `/shop.html?q=${encodeURIComponent(q)}`; });
  $('#global-search')?.addEventListener('input', () => renderSearchSuggestions($('#global-search').value));
  $('#global-search')?.addEventListener('focus', () => { if ($('#global-search').value.trim()) renderSearchSuggestions($('#global-search').value); });
  $('#header-cart-button')?.addEventListener('click', openCart);
  $('#mobile-cart-button')?.addEventListener('click', openCart);
  updateCartBadges();
}
async function renderSearchSuggestions(query) {
  const target = $('#search-suggestions'); if (!target) return;
  const raw = String(query || '').trim();
  if (!raw) { searchSuggestionSequence++; target.classList.remove('open'); target.innerHTML = ''; return; }
  const sequence = ++searchSuggestionSequence;
  target.innerHTML = '<div class="search-suggestion search-suggestion-loading"><span><strong>Finding matches…</strong><small>Products, categories and sellers</small></span></div>';
  target.classList.add('open');
  try {
    const result = await api(`/api/products?q=${encodeURIComponent(raw)}`);
    if (sequence !== searchSuggestionSequence || !$('#global-search')) return;
    const found = (result.products || []).slice(0,7);
    target.innerHTML = found.length ? found.map((p) => `<a class="search-suggestion" href="${productHref(p)}"><img src="${esc(p.image_url || imageFallback)}" alt="" loading="lazy"><span><strong>${esc(p.name)}</strong><small>${esc(p.category)} · ${money(p.price)}</small></span></a>`).join('') + `<a class="search-suggestion search-view-all" href="/shop.html?q=${encodeURIComponent(raw)}"><span><strong>View all matching results ↗</strong><small>Search “${esc(raw)}” across the catalogue</small></span></a>` : `<a class="search-suggestion" href="/shop.html?q=${encodeURIComponent(raw)}"><span><strong>Search for “${esc(raw)}”</strong><small>No exact suggestion — view all matching results</small></span></a>`;
  } catch {
    if (sequence !== searchSuggestionSequence) return;
    const q = raw.toLowerCase();
    const found = allProducts.filter((p) => `${p.name} ${p.category} ${p.seller_name || ''} ${p.description || ''}`.toLowerCase().includes(q)).slice(0,7);
    target.innerHTML = found.length ? found.map((p) => `<a class="search-suggestion" href="${productHref(p)}"><img src="${esc(p.image_url || imageFallback)}" alt="" loading="lazy"><span><strong>${esc(p.name)}</strong><small>${esc(p.category)} · ${money(p.price)}</small></span></a>`).join('') : `<a class="search-suggestion" href="/shop.html?q=${encodeURIComponent(raw)}"><span><strong>Search for “${esc(raw)}”</strong><small>View matching products</small></span></a>`;
  }
}
async function loadInitialData() {
  try {
    const config = await api('/api/config'); storeConfig = { ...storeConfig, ...config };
    if (config.firebase) await initializeFirebase(config.firebase);
  } catch (error) { console.warn('Store config could not be loaded:',error.message); }
  try { const result=await api('/api/public/categories');if(result.categories?.length)categories=result.categories.map(c=>({name:c.name,icon:c.icon||'✨',color:c.color||'#f4f5f7',copy:c.description||''})); } catch(error) { console.warn('Using built-in category display:',error.message); }
  try { const result = await api('/api/products'); allProducts = result.products || []; } catch (error) { console.error(error); }
  try { const {user} = await api('/api/auth/me'); currentUser = user; cleanLegacySession(); } catch { currentUser = null; cleanLegacySession(); }
  if (firebaseService?.auth?.currentUser && !currentUser) { try { await syncFirebaseUser(firebaseService.auth.currentUser); } catch (error) { lastFirebaseError = error.message; } }
  if ($('#header-account-label')) $('#header-account-label').textContent = currentUser?.name?.split(' ')[0] || 'Sign in';
  if (currentUser) { await loadWishlistFromAccount(); await loadCartFromAccount(); }
  updateCartBadges();
  renderPage();
}
async function initializeFirebase(config) {
  try {
    const [appSdk, authSdk] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js')
    ]);
    const firebaseApp = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(config);
    const auth = authSdk.getAuth(firebaseApp);
    await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
    firebaseService = { ...authSdk, auth };
    return firebaseService;
  } catch (error) { console.warn('Firebase browser SDK did not initialize. Check network and Firebase configuration.', error); firebaseService = null; return null; }
}
async function syncFirebaseUser(firebaseUser) {
  const idToken = await firebaseUser.getIdToken(true);
  const data = await api('/api/auth/firebase', { method:'POST', body:JSON.stringify({idToken}) });
  currentUser = data.user; cleanLegacySession();
  if ($('#header-account-label')) $('#header-account-label').textContent = currentUser.name.split(' ')[0] || 'Account';
  return data.user;
}
function renderPage() {
  renderCategoryCards($('#home-category-grid'));
  const page = currentPage();
  if (page === 'home') renderHome();
  if (page === 'shop') renderShop();
  if (page === 'categories') renderCategoriesPage();
  if (page === 'deals') renderDeals();
  if (page === 'product') renderProductPage();
  if (page === 'account') renderAccountPage();
  if (page === 'orders') renderOrdersPage();
  if (page === 'wishlist') renderWishlistPage();
  if (page === 'businesses') renderBusinessesPage();
  if (page === 'info') renderInfoPage();
  wireCopyCoupon();
}
function renderHome() {
  renderGrid($('#featured-grid'), [...allProducts].sort((a,b) => (b.sold_count||0)-(a.sold_count||0) || Number(b.featured)-Number(a.featured)).slice(0,8));
  renderGrid($('#new-grid'), [...allProducts].sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,4));
  const flash = allProducts.filter((p) => p.flash_sale || discountPercent(p)>0).slice(0,4);
  renderGrid($('#flash-grid'), flash);
  runCountdown($('#flash-timer')); runCountdown($('#deals-timer'));
  api('/api/public/banners').then(({banners=[]})=>{
    const banner=banners[0]; if(!banner) return;
    const hero=$('.hero-banner'); if(!hero) return;
    const pill=$('.hero-content .sale-pill',hero); const kicker=$('.hero-kicker',hero); const heading=$('.hero-content h1',hero); const description=$('.hero-description',hero); const primary=$('.hero-cta a',hero); const image=$('.hero-product-main img',hero);
    if(pill) pill.innerHTML=`<span class="pulse-dot"></span> ${esc(banner.title)}`;
    if(kicker) kicker.textContent='EXORA MARKETPLACE · SRI LANKA';
    if(heading) heading.textContent=banner.title;
    if(description) description.textContent=banner.subtitle||'Explore fresh finds and limited-time offers from the Exora marketplace.';
    if(primary){primary.textContent=`${banner.cta_text||'Shop now'} ↗`;primary.href=cleanBannerTarget(banner.target_url);}
    if(image&&banner.image_url) image.src=banner.image_url;
  }).catch(()=>{});
}
function cleanBannerTarget(value){const target=String(value||'/deals.html');return target.startsWith('/')&&!target.startsWith('//')?target:(/^https:\/\//i.test(target)?target:'/deals.html');}
function runCountdown(element) {
  if (!element) return;
  const now=Date.now();
  const configuredEnds=allProducts.filter((p)=>p.flash_sale&&p.flash_ends_at).map((p)=>new Date(String(p.flash_ends_at).replace(' ','T')).getTime()).filter((t)=>Number.isFinite(t)&&t>now);
  const key = `exora_flash_end_${new Date().toDateString()}`;
  const usesConfiguredEnd=configuredEnds.length>0;
  let end=usesConfiguredEnd?Math.min(...configuredEnds):Number(sessionStorage.getItem(key)||0);
  if(!usesConfiguredEnd&&(!end||end<now)){end=now+7*60*60*1000+12*60*1000;sessionStorage.setItem(key,String(end));}
  const update=()=>{let sec=Math.max(0,Math.floor((end-Date.now())/1000));const h=String(Math.floor(sec/3600)).padStart(2,'0'),m=String(Math.floor(sec%3600/60)).padStart(2,'0'),s=String(sec%60).padStart(2,'0');element.innerHTML=`<b>${h}</b><i>:</i><b>${m}</b><i>:</i><b>${s}</b>`;if(usesConfiguredEnd&&sec===0)element.setAttribute('aria-label','Flash sale has ended');};
  update();window.setInterval(update,1000);
}
function renderShop() {
  const params = new URLSearchParams(location.search); const search = params.get('q') || ''; const category = params.get('category') || 'All'; const sort = params.get('sort') || 'featured';
  const input = $('#catalog-search'); const sortSelect = $('#catalog-sort'); if(input) input.value = search; if(sortSelect) sortSelect.value = sort;
  const target = $('#catalog-grid'); const count = $('#result-count'); const empty = $('#catalog-empty'); const loadMoreButton = $('#catalog-load-more'); const pageNote = $('#catalog-page-note');
  const filter = async (append = false) => {
    const q = ($('#catalog-search')?.value || '').trim(); const sortValue = $('#catalog-sort')?.value || 'featured';
    const criteria = JSON.stringify({ q:q.toLowerCase(), category, sort:sortValue });
    if (append && criteria !== shopCriteria) append = false;
    if (shopLoading) { if (append) return; }
    const sequence = ++shopQuerySequence;
    if (!append) { shopOffset = 0; shopTotal = 0; shopResults = []; shopCriteria = criteria; }
    shopLoading = true;
    if (loadMoreButton) { loadMoreButton.disabled = true; loadMoreButton.textContent = append ? 'Loading…' : 'Preparing catalogue…'; loadMoreButton.classList.add('hidden'); }
    if (count) count.textContent = q ? `Searching the catalogue for “${q}”…` : 'Loading products…';
    try {
      const query = new URLSearchParams({ q, sort:sortValue, limit:'120', offset:String(shopOffset) });
      if (category && category !== 'All') query.set('category', category);
      const result = await api(`/api/products?${query.toString()}`);
      if (sequence !== shopQuerySequence) return;
      const pageProducts = result.products || [];
      shopTotal = Number(result.total || 0); shopResults = append ? [...shopResults,...pageProducts] : pageProducts; shopOffset = Number(result.offset || 0) + pageProducts.length; shopCriteria = criteria;
      if (append) { if (pageProducts.length) target.insertAdjacentHTML('beforeend',pageProducts.map(productCard).join('')); if(empty)empty.classList.toggle('hidden',shopResults.length>0); updateWishlistHearts(); }
      else renderGrid(target,pageProducts,empty);
      if(count) count.textContent = `${shopTotal.toLocaleString()} matching product${shopTotal===1?'':'s'}${q ? ` for “${q}”` : ''}`;
      if(pageNote) pageNote.textContent = shopTotal ? `Showing ${shopResults.length.toLocaleString()} of ${shopTotal.toLocaleString()} products` : '';
      if(loadMoreButton){loadMoreButton.classList.toggle('hidden',shopOffset>=shopTotal);loadMoreButton.disabled=false;loadMoreButton.textContent='Load more products ↓';}
      if (q) history.replaceState({},'',`/shop.html?q=${encodeURIComponent(q)}${category&&category!=='All'?`&category=${encodeURIComponent(category)}`:''}${sortValue!=='featured'?`&sort=${encodeURIComponent(sortValue)}`:''}`);
    } catch (error) {
      if (sequence !== shopQuerySequence) return;
      if(count) count.textContent = 'Could not load products. Please try again.';
      if(target&&!append) target.innerHTML = `<div class="inline-message error">${esc(error.message)}</div>`;
      if(loadMoreButton){loadMoreButton.classList.remove('hidden');loadMoreButton.disabled=false;loadMoreButton.textContent='Retry loading products ↻';}
    } finally {
      if (sequence === shopQuerySequence) shopLoading = false;
    }
  };
  const catTarget = $('#catalog-categories'); if(catTarget) catTarget.innerHTML = `<button class="filter-category ${category==='All'?'active':''}" data-filter-category="All">All products <small>${allProducts.length}</small></button>` + categories.filter((c)=>allProducts.some((p)=>p.category.toLowerCase()===c.name.toLowerCase())).map((c)=>`<button class="filter-category ${category.toLowerCase()===c.name.toLowerCase()?'active':''}" data-filter-category="${esc(c.name)}">${c.icon} ${esc(c.name)} <small>${allProducts.filter((p)=>p.category.toLowerCase()===c.name.toLowerCase()).length}</small></button>`).join('');
  input?.addEventListener('input',()=>{window.clearTimeout(searchDebounce);searchDebounce=window.setTimeout(()=>filter(false),180);});
  sortSelect?.addEventListener('change',()=>filter(false));
  $('#catalog-clear')?.addEventListener('click',()=>{if(input)input.value='';if(sortSelect)sortSelect.value='featured';history.replaceState({},'','/shop.html');filter(false);});
  loadMoreButton?.addEventListener('click',()=>filter(true));
  catTarget?.addEventListener('click',(event)=>{const btn=event.target.closest('[data-filter-category]');if(!btn)return;const next=btn.dataset.filterCategory;location.href=`/shop.html?category=${encodeURIComponent(next)}`;});
  filter(false);
}
function renderCategoriesPage() { renderCategoryCards($('#all-category-grid'),true); renderGrid($('#category-products'),allProducts.filter((p)=>p.featured).slice(0,8)); }
function renderDeals() { const products = allProducts.filter((p) => p.flash_sale || discountPercent(p)>0); renderGrid($('#deals-grid'),products,$('#deals-empty')); runCountdown($('#deals-timer')); }
async function renderProductPage() {
  const id = Number(new URLSearchParams(location.search).get('id')); const main = $('#product-detail-page');
  if (!Number.isSafeInteger(id) || id<1) { main.innerHTML = `<div class="empty-state"><span>⌕</span><h2>Product not found</h2><p>Choose a product from the store to view its details.</p><a class="button button-dark" href="/shop.html">Browse products</a></div>`; return; }
  try {
    const data = await api(`/api/products/${id}`); const p=data.product; activeProduct=p; if(!allProducts.some((item)=>Number(item.id)===Number(p.id)))allProducts.push(p);
    document.title = `${p.name} | Exora Sri Lanka`;
    const productUrl = `${location.origin}/product.html?id=${encodeURIComponent(p.id)}`;
    const canonical = $('link[rel="canonical"]'); if(canonical) canonical.href = productUrl;
    const images = (p.image_urls?.length ? p.image_urls : [p.image_url || imageFallback]).slice(0,6);
    const description = String(p.description || `Shop ${p.name} from Exora Sri Lanka. Check the current price, stock, seller and estimated delivery.`).slice(0,300);
    const setMeta = (query, attributes, content) => { let node=$(query); if(!node){node=document.createElement('meta');Object.entries(attributes).forEach(([key,value])=>node.setAttribute(key,value));document.head.append(node);} node.content=content; };
    setMeta('meta[name="description"]',{name:'description'},description);
    setMeta('meta[property="og:type"]',{'property':'og:type'},'product');
    setMeta('meta[property="og:title"]',{'property':'og:title'},document.title);
    setMeta('meta[property="og:description"]',{'property':'og:description'},description);
    setMeta('meta[property="og:url"]',{'property':'og:url'},productUrl);
    setMeta('meta[property="og:image"]',{'property':'og:image'},new URL(images[0] || imageFallback,location.origin).href);
    setMeta('meta[name="twitter:title"]',{name:'twitter:title'},document.title);
    setMeta('meta[name="twitter:description"]',{name:'twitter:description'},description);
    setMeta('meta[name="twitter:image"]',{name:'twitter:image'},new URL(images[0] || imageFallback,location.origin).href);
    let productLd=$('#product-structured-data');if(!productLd){productLd=document.createElement('script');productLd.id='product-structured-data';productLd.type='application/ld+json';document.head.append(productLd);}
    const productJson={'@context':'https://schema.org','@type':'Product',name:p.name,description,image:images.map((image)=>new URL(image,location.origin).href),sku:String(p.id),offers:{'@type':'Offer',url:productUrl,priceCurrency:storeConfig.currency||'LKR',price:String(p.price),availability:p.stock>0?'https://schema.org/InStock':'https://schema.org/OutOfStock'},...(p.review_count?{aggregateRating:{'@type':'AggregateRating',ratingValue:Number(p.rating),reviewCount:Number(p.review_count)}}:{})};
    productLd.textContent=JSON.stringify(productJson);
    const variants = p.variants || [];
    const discount=discountPercent(p);
    main.innerHTML = `<div class="product-detail-layout"><div class="product-gallery"><div class="product-gallery-main"><img id="product-main-image" src="${esc(images[0])}" alt="${esc(p.name)}" onerror="this.onerror=null;this.src='${imageFallback}'">${discount?`<span class="product-discount">-${discount}% OFF</span>`:''}</div><div class="product-thumbnails">${images.map((img,i)=>`<button class="product-thumbnail ${i===0?'active':''}" data-image-index="${i}" type="button" aria-label="View image ${i+1}"><img src="${esc(img)}" alt="" loading="lazy"></button>`).join('')}</div></div><div class="product-detail-copy"><div class="detail-vendor">SOLD BY <b>${esc(p.seller_name||'Exora Direct')}</b> · ${esc(p.category)}</div><h1>${esc(p.name)}</h1><div class="detail-rating">${stars(p)} <span>· ${Number(p.sold_count||0).toLocaleString()} sold</span></div><div class="detail-price-row"><span class="detail-price">${money(p.price)}</span>${discount?`<span class="product-old-price">${money(p.compare_at_price)}</span><span class="product-discount">-${discount}%</span>`:''}</div>${discount?`<div class="detail-savings">You save ${money(p.compare_at_price-p.price)} on this product.</div>`:''}<p class="detail-description">${esc(p.description||'A thoughtfully selected product from the Exora marketplace.')}</p>${variants.length?`<div class="variant-row"><label>Choose option</label><div class="variant-options">${variants.map((v,i)=>`<button type="button" class="variant-option ${i===0?'active':''}" data-variant="${esc(v)}">${esc(v)}</button>`).join('')}</div></div>`:''}<div class="detail-stock-row"><span>${p.stock>0?`<strong>● In stock</strong> · ${p.stock} available`:'<strong style="color:#c52626">Out of stock</strong>'}</span><span>🛍 ${Number(p.sold_count||0)} sold</span></div><div class="delivery-box"><b>🚚 Estimated delivery</b><p>Expected in <strong>${p.delivery_min_days||2}–${p.delivery_max_days||5} days</strong> after your order is accepted. Your order page will show the calendar estimate.</p><p>${Number(p.price)<Number(storeConfig.freeShippingThreshold||15000)?`Free delivery on qualifying orders over ${money(storeConfig.freeShippingThreshold)}.`:'This item may qualify for free delivery.'}</p></div><div class="detail-buy-row"><div class="quantity-control"><button id="product-qty-minus" type="button" aria-label="Decrease quantity">−</button><span id="product-qty">1</span><button id="product-qty-plus" type="button" aria-label="Increase quantity">＋</button></div><button class="button button-dark" id="product-add" type="button" ${p.stock<1?'disabled':''}>Add to cart ↗</button><button class="button button-outline" id="product-wish" type="button">${wishlist.includes(p.id)?'♥ Saved':'♡ Save'}</button></div><div class="seller-info-box"><div class="seller-logo-small">🏬</div><div><b>${esc(p.seller_name||'Exora Direct')}</b><small>Participating Exora seller · Prices in LKR</small></div></div></div></div><section class="reviews-section"><h2>Ratings & reviews <span class="red-period">.</span></h2><p class="form-footnote">Reviews are available to signed-in customers after a paid order or a delivered cash-on-delivery order.</p><div id="product-reviews">${data.reviews.length?data.reviews.map((r)=>`<div class="review-card"><b>${esc(r.name)}</b> <span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span><small> · ${formatDate(r.created_at)}</small><p>${esc(r.comment||'No written comment.')}</p>${r.image_url?`<a class="review-photo-link" href="${esc(r.image_url)}" target="_blank" rel="noopener"><img class="review-photo" src="${esc(r.image_url)}" alt="Customer review photo" loading="lazy"></a>`:''}</div>`).join(''):'<p class="form-footnote">No reviews yet. Verified customers can be the first to share feedback.</p>'}</div>${currentUser?.role==='customer'?`<form class="review-form" id="product-review-form"><select name="rating" aria-label="Rating"><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option></select><input name="comment" maxlength="500" placeholder="Share a helpful review"><label class="review-photo-input">Add a product photo (optional)<input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif"></label><button class="button button-dark" type="submit">Post review</button></form><div id="review-feedback"></div>`:'<button class="button button-outline" id="review-signin" type="button">Sign in to review</button>'}</section>`;
    $('#product-thumbnails')?.addEventListener('click',()=>{});
    $$('.product-thumbnail').forEach((btn)=>btn.addEventListener('click',()=>{$$('.product-thumbnail').forEach((x)=>x.classList.toggle('active',x===btn));$('#product-main-image').src=images[Number(btn.dataset.imageIndex)];}));
    let selectedVariant=variants[0]||'';$$('.variant-option').forEach((btn)=>btn.addEventListener('click',()=>{$$('.variant-option').forEach((x)=>x.classList.toggle('active',x===btn));selectedVariant=btn.dataset.variant||'';}));
    let qty=1;$('#product-qty-minus')?.addEventListener('click',()=>{qty=Math.max(1,qty-1);$('#product-qty').textContent=qty;});$('#product-qty-plus')?.addEventListener('click',()=>{qty=Math.min(20,p.stock,qty+1);$('#product-qty').textContent=qty;});
    $('#product-add')?.addEventListener('click',()=>{addToCart(p.id,qty,selectedVariant);toast(`${p.name}${selectedVariant?` (${selectedVariant})`:''} added to cart.`);});
    $('#product-wish')?.addEventListener('click',()=>{toggleWishlist(p.id);$('#product-wish').textContent=wishlist.includes(p.id)?'♥ Saved':'♡ Save';});
    $('#review-signin')?.addEventListener('click',()=>openAuth('login'));
    $('#product-review-form')?.addEventListener('submit',async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);try{const result=await api(`/api/products/${p.id}/reviews`,{method:'POST',body:form});toast(result.message);await renderProductPage();}catch(error){$('#review-feedback').innerHTML=`<div class="inline-message error">${esc(error.message)}</div>`;}});
    const related=allProducts.filter((x)=>x.id!==p.id&&(x.category===p.category||x.seller_id===p.seller_id)).slice(0,4);renderGrid($('#related-products'),related);
  } catch(error) { main.innerHTML=`<div class="empty-state"><span>!</span><h2>Could not load this product</h2><p>${esc(error.message)}</p><a class="button button-dark" href="/shop.html">Browse products</a></div>`; }
}
function toggleWishlist(id) {
  const n=Number(id); if(wishlist.includes(n)){wishlist=wishlist.filter((x)=>x!==n);toast('Removed from wishlist.');}else{wishlist.push(n);toast('Saved to wishlist.');}
  persistWishlist(); if(currentUser) api(wishlist.includes(n)?'/api/account/wishlist':'/api/account/wishlist',{method:'PUT',body:JSON.stringify({productIds:wishlist})}).catch(()=>{});
}
function addToCart(id, quantity=1, variant='') {
  const p=allProducts.find((item)=>Number(item.id)===Number(id)); if(!p){api(`/api/products/${encodeURIComponent(id)}`).then((result)=>{if(!allProducts.some((item)=>Number(item.id)===Number(result.product.id)))allProducts.push(result.product);addToCart(id,quantity,variant);}).catch(()=>toast('Product could not be loaded.'));return;}
  if(p.stock<1){toast('This product is out of stock.');return;}
  const picked=String(variant||'').slice(0,80);const existing=cart.find((x)=>Number(x.id)===Number(id)&&String(x.variant||'')===picked);if(existing)existing.quantity=Math.min(p.stock,20,existing.quantity+quantity);else cart.push({id:Number(id),quantity:Math.min(p.stock,20,quantity),variant:picked});persistCart();
}
function openModal(html, afterRender) {
  const mount=$('#global-modal'); if(!mount)return;
  mount.innerHTML=`<div class="modal-overlay" id="active-modal-overlay"><section class="modal-card" role="dialog" aria-modal="true"><button class="modal-close" id="modal-x" type="button" aria-label="Close">×</button><div id="active-modal-content">${html}</div></section></div>`;
  $('#modal-x')?.addEventListener('click',closeModal);$('#active-modal-overlay')?.addEventListener('click',(e)=>{if(e.target.id==='active-modal-overlay')closeModal();});document.addEventListener('keydown',escClose,{once:true});if(afterRender)afterRender();
}
function escClose(event){if(event.key==='Escape')closeModal();}
function closeModal(){const mount=$('#global-modal');if(mount)mount.innerHTML='';}
function cartLines() { return cart.map((line,cartIndex)=>({ ...line, cartIndex, product:allProducts.find((p)=>Number(p.id)===Number(line.id)) })).filter((line)=>line.product); }
function cartSubtotal(){return cartLines().reduce((total,line)=>total+line.product.price*line.quantity,0);}
function renderCartModal() {
  const lines=cartLines();
  if(!lines.length){openModal(`<div class="modal-success"><div class="success-mark">🛒</div><h2>Your cart is waiting</h2><p class="modal-intro">Explore Exora and add a few things you love.</p><a class="button button-dark" href="/shop.html">Explore products ↗</a></div>`);return;}
  const subtotal=cartSubtotal();
  openModal(`<span class="eyebrow">YOUR EXORA PICKS</span><h2>Your cart <span style="color:#dc2626">(${cart.reduce((n,x)=>n+x.quantity,0)})</span></h2><p class="modal-intro">Items are checked for current price and stock again at checkout.</p><div class="cart-modal-items">${lines.map((line)=>`<div class="cart-row"><img src="${esc(line.product.image_url||imageFallback)}" alt="${esc(line.product.name)}"><div><strong>${esc(line.product.name)}</strong><small>${money(line.product.price)} · ${esc(line.product.category)}${line.variant?` · Option: ${esc(line.variant)}`:''}</small><div class="cart-qty"><button data-cart-qty="${line.cartIndex}" data-delta="-1" type="button">−</button><b>${line.quantity}</b><button data-cart-qty="${line.cartIndex}" data-delta="1" type="button">＋</button><button data-cart-remove="${line.cartIndex}" type="button">Remove</button></div></div><b class="cart-line-price">${money(line.product.price*line.quantity)}</b></div>`).join('')}</div><div class="checkout-total"><span>Subtotal</span><b>${money(subtotal)}</b></div><p class="form-footnote">${subtotal>=storeConfig.freeShippingThreshold?'You qualify for free delivery.':`Estimated delivery fee ${money(storeConfig.defaultDeliveryFee||450)} · Free delivery over ${money(storeConfig.freeShippingThreshold)}.`}</p><button class="button button-dark button-wide" id="go-checkout" type="button">Continue to checkout ↗</button><button class="button button-outline button-wide" id="continue-shopping-modal" type="button" style="margin-top:8px">Continue shopping</button>`,()=>{
    $$('[data-cart-qty]').forEach((btn)=>btn.addEventListener('click',()=>changeCartQuantity(Number(btn.dataset.cartQty),Number(btn.dataset.delta))));
    $$('[data-cart-remove]').forEach((btn)=>btn.addEventListener('click',()=>{cart.splice(Number(btn.dataset.cartRemove),1);persistCart();renderCartModal();}));
    $('#go-checkout')?.addEventListener('click',()=>beginCheckout());$('#continue-shopping-modal')?.addEventListener('click',closeModal);
  });
}
function changeCartQuantity(index,delta) { const line=cart[index];const p=allProducts.find((x)=>Number(x.id)===Number(line?.id));if(!line||!p)return;line.quantity=Math.max(0,Math.min(Number(p.stock),20,line.quantity+delta));if(!line.quantity)cart.splice(index,1);persistCart();renderCartModal(); }
function openCart(){renderCartModal();}
async function beginCheckout() {
  if(!currentUser){openAuth('login','Sign in to finish your order.');return;}
  const lines=cartLines();if(!lines.length){closeModal();toast('Your cart is empty.');return;}
  let address=null;try{address=(await api('/api/account/address')).address;}catch(error){if(error.message.includes('sign in')){currentUser=null;openAuth('login');return;}}
  const subtotal=cartSubtotal();const deliveryFee=subtotal>=storeConfig.freeShippingThreshold?0:Number(storeConfig.defaultDeliveryFee||450);const minDays=Math.max(...lines.map((x)=>x.product.delivery_min_days||2));const maxDays=Math.max(...lines.map((x)=>x.product.delivery_max_days||5));
  openModal(`<span class="eyebrow">SECURE CHECKOUT</span><h2>Where should we send it?</h2><p class="modal-intro">Your order is verified on the server. Prices, available stock and coupon terms are checked again before saving the order.</p><form id="checkout-form" class="modal-form"><div class="form-field"><label>Recipient name</label><input name="customerName" required minlength="2" maxlength="100" value="${esc(address?.recipient_name||currentUser.name||'')}" autocomplete="name"></div><div class="form-field"><label>Phone number</label><input name="phone" required minlength="7" maxlength="30" value="${esc(address?.phone||'')}" autocomplete="tel" placeholder="07X XXX XXXX"></div><div class="form-field full"><label>Delivery address</label><textarea name="address" required minlength="5" maxlength="300" autocomplete="street-address">${esc(address?.address||'')}</textarea></div><div class="form-field"><label>City / district</label><input name="city" required minlength="2" maxlength="100" value="${esc(address?.city||'')}"></div><div class="form-field"><label>Postal code (optional)</label><input name="postalCode" maxlength="20" value="${esc(address?.postal_code||'')}"></div><div class="form-field full"><label>Payment method</label><select name="paymentMethod"><option value="cash_on_delivery">Cash on delivery (COD)</option><option value="bank_transfer">Bank transfer / deposit</option></select><small class="form-footnote">Card payment will be enabled only after a live payment gateway is configured and verified.</small></div><div class="form-field full"><label>Coupon code</label><div style="display:flex;gap:7px"><input name="couponCode" id="checkout-coupon" maxlength="32" placeholder="WELCOME5" style="flex:1"><button class="button button-outline" id="validate-coupon" type="button">Apply</button></div><div id="coupon-feedback"></div></div><div class="form-field full"><div class="checkout-total"><span>Items subtotal</span><b id="checkout-subtotal">${money(subtotal)}</b></div><div class="checkout-total"><span>Delivery fee</span><b id="checkout-delivery">${deliveryFee?money(deliveryFee):'FREE'}</b></div><div class="checkout-total"><span>Estimated total</span><b id="checkout-total">${money(subtotal+deliveryFee)}</b></div><p class="form-footnote">Estimated delivery: ${formatDate(new Date(Date.now()+minDays*86400000).toISOString())} – ${formatDate(new Date(Date.now()+maxDays*86400000).toISOString())}.</p></div><div class="form-field full"><div id="checkout-feedback"></div><button class="button button-dark button-wide" id="place-order" type="submit">Place order · ${money(subtotal+deliveryFee)}</button></div></form>` ,()=>{
    let coupon=null;const updateTotal=()=>{const discount=coupon?Math.floor(subtotal*coupon.percent_off/100):0;const total=subtotal+deliveryFee-discount;$('#checkout-total').textContent=money(total);$('#place-order').textContent=`Place order · ${money(total)}`;};
    $('#validate-coupon')?.addEventListener('click',async()=>{const code=$('#checkout-coupon').value.trim().toUpperCase();try{const data=await api('/api/coupons/validate',{method:'POST',body:JSON.stringify({code})});coupon=data.coupon;$('#coupon-feedback').innerHTML=`<div class="inline-message success">${esc(data.coupon.code)} applied — ${data.coupon.percent_off}% off.</div>`;}catch(error){coupon=null;$('#coupon-feedback').innerHTML=`<div class="inline-message error">${esc(error.message)}</div>`;}updateTotal();});
    $('#checkout-form')?.addEventListener('submit',async(event)=>{event.preventDefault();const button=$('#place-order');button.disabled=true;button.textContent='Placing your order…';const fd=new FormData(event.currentTarget);try{const result=await api('/api/orders',{method:'POST',body:JSON.stringify({customerName:fd.get('customerName'),phone:fd.get('phone'),address:fd.get('address'),city:fd.get('city'),postalCode:fd.get('postalCode'),paymentMethod:fd.get('paymentMethod'),couponCode:coupon?.code||'',items:cartLines().map(({id,quantity,variant})=>({id,quantity,variant:variant||''}))})});lastOrder={...result.order,paymentMethod:fd.get('paymentMethod')};cart=[];persistCart();closeModal();orderSuccess(lastOrder);}catch(error){$('#checkout-feedback').innerHTML=`<div class="inline-message error">${esc(error.message)}</div>`;button.disabled=false;button.textContent='Try again';}});
  });
}
function orderSuccess(order) {
  const bank=order.paymentMethod==='bank_transfer';
  openModal(`<div class="modal-success"><div class="success-mark">✓</div><span class="eyebrow">ORDER RECEIVED</span><h2>You're all set!</h2><p class="modal-intro">Your order has been saved to your account. Track updates from My Orders.</p><div class="order-code">${esc(order.order_code)}</div><p><b>Order total: ${money(order.total)}</b></p><p class="form-footnote">Estimated delivery: ${formatDate(order.expected_delivery_min)} – ${formatDate(order.expected_delivery_max)}<br>Payment: ${bank?'Bank transfer · pending verification':'Cash on delivery'}</p>${bank?`<div class="form-field" style="text-align:left;margin:14px 0"><label for="receipt-file">Upload bank transfer receipt (JPG/PNG/WEBP/PDF · max 5 MB)</label><input type="file" id="receipt-file" accept="image/jpeg,image/png,image/webp,application/pdf"><button class="button button-outline button-wide" id="upload-receipt" type="button" style="margin-top:8px">Upload receipt</button><div id="receipt-feedback"></div></div>`:''}<a class="button button-dark button-wide" href="/orders.html">Track my order ↗</a><button class="button button-outline button-wide" id="success-done" type="button" style="margin-top:8px">Continue shopping</button></div>`,()=>{
    $('#success-done')?.addEventListener('click',closeModal);
    $('#upload-receipt')?.addEventListener('click',async()=>{const file=$('#receipt-file').files[0];const feedback=$('#receipt-feedback');if(!file){feedback.innerHTML='<div class="inline-message error">Choose a receipt file first.</div>';return;}if(file.size>5*1024*1024){feedback.innerHTML='<div class="inline-message error">File must be 5 MB or smaller.</div>';return;}const body=new FormData();body.append('receipt',file);const button=$('#upload-receipt');button.disabled=true;try{const result=await api(`/api/orders/${order.id}/receipt`,{method:'POST',body});feedback.innerHTML=`<div class="inline-message success">${esc(result.message)}</div>`;button.textContent='Receipt uploaded';}catch(error){feedback.innerHTML=`<div class="inline-message error">${esc(error.message)}</div>`;button.disabled=false;}});
  });
}
function authHtml(mode='login', notice='') {
  const register=mode==='register';
  return `<div class="auth-card"><span class="eyebrow">WELCOME TO EXORA</span><h1>${register?'Create your account':'Good to see you again.'}</h1><p>${register?'Save addresses, track every order and keep your favourite finds together.':'Sign in to see your saved details, order history and delivery updates.'}</p>${notice?`<div class="inline-message success">${esc(notice)}</div>`:''}<div id="auth-feedback"></div><div class="auth-provider-row"><button type="button" class="auth-provider-button" id="auth-google">G&nbsp; Continue with Google</button><button type="button" class="auth-provider-button" id="auth-apple">&nbsp; Continue with Apple</button></div><div class="auth-divider">or use email and password</div><form id="auth-form" class="auth-form">${register?`<div class="form-field"><label>Full name</label><input name="name" required minlength="2" maxlength="80" autocomplete="name" placeholder="Your name"></div>`:''}<div class="form-field"><label>Email address</label><input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></div><div class="form-field"><label>Password</label><input name="password" type="password" required minlength="${firebaseService?6:10}" maxlength="128" autocomplete="${register?'new-password':'current-password'}" placeholder="${firebaseService?'At least 6 characters':'At least 10 characters'}"></div>${register&&firebaseService?'<p class="form-footnote">Firebase will email a verification link before your account can sign in.</p>':''}<button type="submit" class="button button-dark button-wide" id="auth-submit">${register?'Create account':'Sign in'} ↗</button></form><p class="form-footnote" style="text-align:center">${!register?'<button type="button" class="auth-switch" id="forgot-password">Forgot password?</button> · ':''}<button type="button" class="auth-switch" id="auth-switch">${register?'Already have an account? Sign in':'New to Exora? Create an account'}</button></p><p class="form-footnote">Passwords are never shown in the admin panel. When Firebase is connected, the browser uses Firebase Authentication; otherwise this local development build uses the secure server sign-in.</p></div>`;
}
function openAuth(mode='login', notice='') {
  openModal(authHtml(mode,notice),()=>{
    const isRegister=mode==='register';
    $('#auth-switch')?.addEventListener('click',()=>openAuth(isRegister?'login':'register'));
    $('#auth-form')?.addEventListener('submit',async(event)=>{event.preventDefault();const fd=new FormData(event.currentTarget);const button=$('#auth-submit');button.disabled=true;button.textContent='Please wait…';const feedback=$('#auth-feedback');feedback.innerHTML='';try{
      let user;
      if(firebaseService){
        if(isRegister){const credential=await firebaseService.createUserWithEmailAndPassword(firebaseService.auth,String(fd.get('email')).trim(),String(fd.get('password')));await firebaseService.updateProfile(credential.user,{displayName:String(fd.get('name')).trim()});await firebaseService.sendEmailVerification(credential.user);await firebaseService.signOut(firebaseService.auth);openAuth('login','A verification email was sent. Verify your email, then sign in.');return;}
        const credential=await firebaseService.signInWithEmailAndPassword(firebaseService.auth,String(fd.get('email')).trim(),String(fd.get('password')));
        if(!credential.user.emailVerified){await firebaseService.signOut(firebaseService.auth);throw new Error('Please verify your email first. Open the link sent by Firebase, then sign in again.');}
        user=await syncFirebaseUser(credential.user);
      } else {
        const body=isRegister?{name:fd.get('name'),email:fd.get('email'),password:fd.get('password')}:{email:fd.get('email'),password:fd.get('password')};
        const result=await api(`/api/auth/${isRegister?'register':'login'}`,{method:'POST',body:JSON.stringify(body)});user=result.user;
      }
      if(user.role==='admin'){await api('/api/auth/logout',{method:'POST'});throw new Error('Use the dedicated Admin Panel sign-in.');}
      currentUser=user;cleanLegacySession();if($('#header-account-label'))$('#header-account-label').textContent=user.name.split(' ')[0];closeModal();toast(isRegister?'Account created successfully.':'Welcome back.');await loadWishlistFromAccount();await loadCartFromAccount();
      const page=currentPage();if(page==='account')renderAccountPage();if(page==='orders')renderOrdersPage();if(cart.length)beginCheckout();
    }catch(error){feedback.innerHTML=`<div class="inline-message error">${esc(error.message||'Sign-in failed.')}</div>`;}finally{if($('#auth-submit')){button.disabled=false;button.textContent=isRegister?'Create account ↗':'Sign in ↗';}}});
    $('#auth-google')?.addEventListener('click',()=>providerLogin('google'));
    $('#auth-apple')?.addEventListener('click',()=>providerLogin('apple'));
    $('#forgot-password')?.addEventListener('click',async()=>{const email=$('#auth-form input[name="email"]')?.value.trim();if(!email){$('#auth-feedback').innerHTML='<div class="inline-message error">Enter your email address first.</div>';return;}if(!firebaseService){$('#auth-feedback').innerHTML='<div class="inline-message error">Password recovery requires Firebase Authentication to be configured.</div>';return;}try{await firebaseService.sendPasswordResetEmail(firebaseService.auth,email);$('#auth-feedback').innerHTML='<div class="inline-message success">Password reset instructions have been sent if the account exists.</div>';}catch(error){$('#auth-feedback').innerHTML=`<div class="inline-message error">${esc(error.message)}</div>`;}});
  });
}
async function providerLogin(provider) {
  const feedback=$('#auth-feedback');
  if(!firebaseService){feedback.innerHTML='<div class="inline-message error">Google and Apple sign-in are ready to connect after you configure a Firebase project in .env and enable those providers in Firebase Console.</div>';return;}
  try{let providerObject;if(provider==='google')providerObject=new firebaseService.GoogleAuthProvider();else{providerObject=new firebaseService.OAuthProvider('apple.com');providerObject.addScope('email');providerObject.addScope('name');}const credential=await firebaseService.signInWithPopup(firebaseService.auth,providerObject);const user=await syncFirebaseUser(credential.user);if(user.role==='admin')throw new Error('Admin must use the dedicated admin login.');currentUser=user;closeModal();toast(`Signed in with ${provider==='google'?'Google':'Apple'}.`);await loadWishlistFromAccount();await loadCartFromAccount();if(currentPage()==='account')renderAccountPage();if(currentPage()==='orders')renderOrdersPage();if(cart.length)beginCheckout();}catch(error){feedback.innerHTML=`<div class="inline-message error">${esc(error.message||'Provider sign-in failed. Check provider settings in Firebase Console.')}</div>`;}
}
async function signOut(){window.clearTimeout(cartSyncTimer);if(currentUser?.role==='customer'){try{await api('/api/account/cart',{method:'PUT',body:JSON.stringify({items:cart.map(({id,quantity,variant})=>({id,quantity,variant:variant||''}))})});}catch{} }try{await api('/api/auth/logout',{method:'POST'});}catch{}if(firebaseService)try{await firebaseService.signOut(firebaseService.auth);}catch{}currentUser=null;cart=[];wishlist=[];localStorage.setItem('exora_cart','[]');localStorage.setItem('exora_wishlist','[]');localStorage.removeItem('exora_cart_owner_id');localStorage.removeItem('exora_wishlist_owner_id');cleanLegacySession();updateCartBadges();updateWishlistHearts();if($('#header-account-label'))$('#header-account-label').textContent='Sign in';toast('Signed out. Your account cart and wishlist remain saved securely to your account.');if(currentPage()==='account')renderAccountPage();if(currentPage()==='orders')renderOrdersPage();}
async function loadWishlistFromAccount(){if(!currentUser||currentUser.role!=='customer')return;try{const result=await api('/api/account/wishlist');const owner=localStorage.getItem('exora_wishlist_owner_id');const mergeLocal=!owner||owner===String(currentUser.id);wishlist=[...new Set(mergeLocal?[...wishlist,...(result.productIds||[])]:result.productIds||[])];localStorage.setItem('exora_wishlist_owner_id',String(currentUser.id));persistWishlist();await api('/api/account/wishlist',{method:'PUT',body:JSON.stringify({productIds:wishlist})});}catch{} }
async function loadCartFromAccount(){if(!currentUser||currentUser.role!=='customer')return;window.clearTimeout(cartSyncTimer);try{const result=await api('/api/account/cart');const serverItems=result.items||[];for(const item of serverItems){if(!allProducts.some((p)=>Number(p.id)===Number(item.id)))allProducts.push({...item,variants:item.variants||[]});}const owner=localStorage.getItem('exora_cart_owner_id');const mergeLocal=!owner||owner===String(currentUser.id);const candidates=mergeLocal?[...serverItems,...cart]:serverItems;const merged=new Map();for(const item of candidates){const id=Number(item.id),p=allProducts.find((x)=>Number(x.id)===id)||serverItems.find((x)=>Number(x.id)===id);if(!p||Number(p.stock)<1)continue;let variant=String(item.variant||'').slice(0,80);const options=p.variants||[];if(variant){const match=options.find((x)=>String(x).toLowerCase()===variant.toLowerCase());if(!match)variant='';else variant=match;}const key=`${id}::${variant.toLowerCase()}`;const old=merged.get(key);const quantity=Math.min(20,Number(p.stock),Number(old?.quantity||0)+Number(item.quantity||0));if(quantity>0)merged.set(key,{id,quantity,variant});}cart=[...merged.values()];localStorage.setItem('exora_cart',JSON.stringify(cart));localStorage.setItem('exora_cart_owner_id',String(currentUser.id));updateCartBadges();await api('/api/account/cart',{method:'PUT',body:JSON.stringify({items:cart})});}catch(error){console.warn('Account cart could not be synchronised yet:',error.message);}}
async function renderAccountPage() {
  const root=$('#account-page-content');if(!root)return;
  if(!currentUser){root.innerHTML=`<div class="auth-card"><span class="eyebrow">YOUR EXORA ACCOUNT</span><h1>Everything in one place.</h1><p>Sign in to keep your delivery address, order history, wishlist and profile details saved to your account.</p><button class="button button-dark button-wide" id="account-signin">Sign in / Create account ↗</button></div>`;$('#account-signin')?.addEventListener('click',()=>openAuth('login'));return;}
  let address=null;try{address=(await api('/api/account/address')).address;}catch{}
  const a=address||{};
  root.innerHTML=`<div class="account-layout"><aside class="account-sidebar"><div class="account-user-block"><div class="avatar-circle">${esc((currentUser.name||'E').charAt(0).toUpperCase())}</div><div><strong>${esc(currentUser.name)}</strong><small>${esc(currentUser.email)}</small></div></div><nav class="account-nav"><a class="active" href="/account.html">♙ Profile & address</a><a href="/orders.html">▣ My orders</a><a href="/wishlist.html">♡ Wishlist</a><button id="account-signout" type="button">↪ Sign out</button></nav></aside><section class="account-panel"><span class="eyebrow">ACCOUNT DETAILS</span><h2>My profile</h2><p>Your account details and saved address are stored in the Exora database. Sign in again to retrieve them.</p><form id="profile-form" class="profile-form"><div class="form-field"><label>Full name</label><input name="name" required minlength="2" maxlength="80" value="${esc(currentUser.name)}"></div><div class="form-field"><label>Email address</label><input value="${esc(currentUser.email)}" readonly></div><div class="form-actions"><button class="button button-dark" type="submit">Save profile</button></div></form><div style="border-top:1px solid var(--line);margin:23px 0"></div><span class="eyebrow">SAVED SHIPPING DETAILS</span><h2>Delivery address</h2><p>This address is remembered for your next checkout.</p><form id="saved-address-form" class="address-form"><div class="form-field"><label>Recipient name</label><input name="recipientName" required minlength="2" value="${esc(a.recipient_name||currentUser.name)}"></div><div class="form-field"><label>Phone number</label><input name="phone" required minlength="7" value="${esc(a.phone||'')}"></div><div class="form-field full"><label>Street address</label><textarea name="address" required minlength="5">${esc(a.address||'')}</textarea></div><div class="form-field"><label>City</label><input name="city" required minlength="2" value="${esc(a.city||'')}"></div><div class="form-field"><label>Postal code</label><input name="postalCode" value="${esc(a.postal_code||'')}"></div><div class="form-actions"><button class="button button-dark" type="submit">Save address</button></div></form><div id="account-feedback"></div></section></div>`;
  $('#account-signout')?.addEventListener('click',signOut);
  $('#profile-form')?.addEventListener('submit',async(event)=>{event.preventDefault();try{const form=new FormData(event.currentTarget);const result=await api('/api/account/profile',{method:'PUT',body:JSON.stringify({name:form.get('name')})});currentUser=result.user;toast('Profile saved.');renderAccountPage();}catch(error){$('#account-feedback').innerHTML=`<div class="inline-message error">${esc(error.message)}</div>`;}});
  $('#saved-address-form')?.addEventListener('submit',async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);try{const result=await api('/api/account/address',{method:'PUT',body:JSON.stringify({recipientName:form.get('recipientName'),phone:form.get('phone'),address:form.get('address'),city:form.get('city'),postalCode:form.get('postalCode')})});$('#account-feedback').innerHTML=`<div class="inline-message success">${esc(result.message)}</div>`;}catch(error){$('#account-feedback').innerHTML=`<div class="inline-message error">${esc(error.message)}</div>`;}});
}
async function renderOrdersPage() {
  const root=$('#orders-page-content');if(!root)return;
  if(!currentUser){root.innerHTML=`<div class="auth-card"><span class="eyebrow">ORDER TRACKING</span><h1>Your orders, all together.</h1><p>Sign in to see your previous orders, payment details and estimated delivery dates.</p><button class="button button-dark button-wide" id="orders-signin">Sign in to view orders ↗</button></div>`;$('#orders-signin')?.addEventListener('click',()=>openAuth('login'));return;}
  root.innerHTML='<div class="order-skeleton"></div><div class="order-skeleton"></div>';
  try{const data=await api('/api/account/orders');const orders=data.orders||[];if(!orders.length){root.innerHTML=`<div class="empty-state"><span>▣</span><h2>No orders yet</h2><p>When you place an order, its status and delivery estimate will appear here.</p><a class="button button-dark" href="/shop.html">Start shopping ↗</a></div>`;return;}
    root.innerHTML=`<div class="order-list">${orders.map((o)=>`<article class="order-card"><div class="order-card-head"><div><strong>${esc(o.order_code)}</strong><small>Placed ${new Date(o.created_at.replace(' ','T')+'Z').toLocaleDateString('en-LK',{day:'numeric',month:'short',year:'numeric'})}</small></div><div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end"><span class="status-pill ${esc(o.order_status)}">${esc(o.order_status)}</span><span class="status-pill ${esc(o.payment_status)}">${esc(o.payment_status==='paid'?'Paid':o.payment_status==='pending'?'Payment pending':o.payment_status)}</span></div></div><div class="order-card-items">${(o.items||[]).map((i)=>`<div><span>${esc(i.product_name)}${i.variant?` · ${esc(i.variant)}`:''} × ${i.quantity}</span><b>${money(i.unit_price*i.quantity)}</b></div>`).join('')}<div><span>Delivery fee</span><b>${o.delivery_fee?money(o.delivery_fee):'Free'}</b></div></div><div class="delivery-box"><b>🚚 Estimated arrival</b><p>${formatDate(o.expected_delivery_min)} – ${formatDate(o.expected_delivery_max)}. This is an estimate and may change if a courier delay occurs.</p></div><div class="order-card-foot"><small>${esc(o.payment_method.replaceAll('_',' '))} · Order tracking</small><b>${money(o.total)}</b></div>${o.payment_method==='bank_transfer'&&o.payment_status==='pending'?`<div class="form-field" style="margin-top:13px"><label>Bank transfer receipt (JPG / PNG / WEBP / PDF · max 5 MB)</label><input type="file" data-receipt-file="${o.id}" accept="image/jpeg,image/png,image/webp,application/pdf"><button class="button button-outline" type="button" data-upload-order-receipt="${o.id}" style="margin-top:6px">Upload receipt</button><div id="receipt-note-${o.id}"></div></div>`:''}</article>`).join('')}</div>`;
    $$('[data-upload-order-receipt]').forEach((button)=>button.addEventListener('click',async()=>{const id=Number(button.dataset.uploadOrderReceipt);const file=$(`[data-receipt-file="${id}"]`)?.files[0];const note=$(`#receipt-note-${id}`);if(!file){note.innerHTML='<div class="inline-message error">Choose a receipt first.</div>';return;}if(file.size>5*1024*1024){note.innerHTML='<div class="inline-message error">File must be 5 MB or smaller.</div>';return;}const fd=new FormData();fd.append('receipt',file);button.disabled=true;try{const data=await api(`/api/orders/${id}/receipt`,{method:'POST',body:fd});note.innerHTML=`<div class="inline-message success">${esc(data.message)}</div>`;}catch(error){note.innerHTML=`<div class="inline-message error">${esc(error.message)}</div>`;button.disabled=false;}}));
  }catch(error){root.innerHTML=`<div class="inline-message error">${esc(error.message)} <button id="orders-retry" class="auth-switch" type="button">Try again</button></div>`;$('#orders-retry')?.addEventListener('click',renderOrdersPage);}
}
function renderWishlistPage() {
  const root=$('#wishlist-grid'); if(!root)return;
  const products=allProducts.filter((p)=>wishlist.includes(Number(p.id)));renderGrid(root,products,$('#wishlist-empty'));
}
async function renderBusinessesPage(){const root=$('#public-seller-list');if(!root)return;try{const data=await api('/api/public/sellers');const sellers=data.sellers||[];root.innerHTML=sellers.length?sellers.map((s)=>`<article class="seller-card"><div class="seller-logo">🏬</div><h3>${esc(s.business_name)}</h3><small>📍 ${esc(s.region||'Sri Lanka')}</small><p>${Number(s.product_count)} active product(s) listed on Exora. Seller metrics are based on recorded Exora transactions.</p><a class="arrow-link" href="/shop.html?q=${encodeURIComponent(s.business_name)}">View seller products ↗</a></article>`).join(''):`<div class="empty-state"><h2>No active sellers yet</h2><p>Check again when sellers are onboarded.</p></div>`;}catch(error){root.innerHTML=`<div class="inline-message error">${esc(error.message)}</div>`;}}
function renderInfoPage(){const root=$('#info-content');if(!root)return;const section=new URLSearchParams(location.search).get('section')||'faq';const map={faq:{label:'Frequently asked questions',title:'How can we help?',html:`<h2>How can I place an order?</h2><p>Choose a product, add it to your cart, sign in and complete the checkout form. Save your order number and follow the status from My Orders.</p><h2>What payment methods are available?</h2><p>This starter project supports Cash on Delivery and bank transfer with receipt upload. A live card payment gateway must be configured and tested separately before it can be offered.</p><h2>Does uploading a bank slip confirm payment?</h2><p>No. The store administrator must verify the transaction through the bank before marking an order paid.</p><h2>How do I track delivery?</h2><p>Open My Orders to see the current order status and estimated date range.</p>`},shipping:{label:'Shipping & Delivery',title:'Shipping & delivery',html:`<h2>Estimated arrival</h2><p>Each product can have a delivery estimate set by the store administrator. The checkout order uses the longest estimate among the products and displays an expected date range.</p><h2>Delivery fees</h2><p>The demo configuration charges the amount set in the server environment until the free-shipping threshold is met. Final fees must be confirmed with your courier and delivery zones before launch.</p><p class="legal-note">The displayed range is an estimate, not a guaranteed courier promise. Configure shipping zones, courier rates and holiday schedules before going live.</p>`},returns:{label:'Returns & Refunds',title:'Returns & refunds',html:`<h2>Request a return</h2><p>Contact Exora support with your order number, the product name and a description of the issue. Keep packaging and proof of purchase where possible.</p><h2>Refund processing</h2><p>Refunds should be reviewed by an administrator and recorded against the order. The starter includes payment status fields but does not automatically send money back to a bank or payment gateway.</p><p class="legal-note">Set the final returns window and product exclusions based on applicable Sri Lankan consumer-protection requirements before launch.</p>`},privacy:{label:'Privacy Policy',title:'Privacy & data',html:`<h2>What Exora stores</h2><p>The store keeps account details, saved addresses, order records and review details needed to operate shopping features. Passwords are hashed in the local-demo account system; Firebase passwords are managed by Firebase Authentication when configured and are never displayed to store administrators.</p><h2>Cookies and local storage</h2><p>An HttpOnly session cookie keeps the sign-in session active. Guest cart and device preferences use local storage; after sign-in, cart and wishlist also synchronise with the account database. Receipt uploads are kept private and require administrator authentication to download.</p><h2>Before public launch</h2><p>Publish a business-specific privacy notice, set retention periods, secure backups, restrict administrator access and explain how customers can request account-data changes or deletion.</p>`},terms:{label:'Terms & Conditions',title:'Terms & conditions',html:`<h2>Product prices and availability</h2><p>Product prices, discounts and stock are rechecked by the server at checkout. A saved cart does not reserve inventory or guarantee that a sale price will remain available.</p><h2>Orders and payments</h2><p>Orders may remain pending until the store confirms them. A customer-uploaded transfer receipt is not automatic proof of payment. Card payments are not enabled in this starter until a payment provider is configured.</p><h2>Marketplace sellers</h2><p>Seller metrics reflect sales recorded through Exora and do not represent each business's total sales outside the platform.</p>`}};const item=map[section]||map.faq;$('#info-breadcrumb').textContent=item.label;document.title=`${item.title} | Exora Sri Lanka`;const infoUrl=`${location.origin}/info.html?section=${encodeURIComponent(section)}`;const infoDescription=String(item.title+' — Exora Sri Lanka shopping help, delivery information and store policies.').slice(0,300);const canonical=$('link[rel="canonical"]');if(canonical)canonical.href=infoUrl;const setInfoMeta=(query,attrs,content)=>{let node=$(query);if(!node){node=document.createElement('meta');Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,value));document.head.append(node);}node.content=content;};setInfoMeta('meta[name="description"]',{name:'description'},infoDescription);setInfoMeta('meta[property="og:title"]',{'property':'og:title'},document.title);setInfoMeta('meta[property="og:description"]',{'property':'og:description'},infoDescription);setInfoMeta('meta[property="og:url"]',{'property':'og:url'},infoUrl);root.innerHTML=`<span class="eyebrow">EXORA HELP CENTRE</span><h1>${item.title}</h1>${item.html}`;$$('.info-sidebar a').forEach((a)=>a.classList.toggle('active',new URL(a.href).searchParams.get('section')===section));}
function wireCopyCoupon(){const copy=async()=>{try{await navigator.clipboard.writeText('WELCOME5');toast('WELCOME5 copied.');}catch{toast('Use WELCOME5 at checkout.');}};$('#copy-coupon')?.addEventListener('click',copy);$('#deals-copy-coupon')?.addEventListener('click',copy);}
// One shared click delegate handles cards rendered on initial load and after filtering.
document.addEventListener('click',(event)=>{const add=event.target.closest('[data-add]');if(add){event.preventDefault();event.stopPropagation();addToCart(Number(add.dataset.add));toast('Added to your cart.');return;}const wish=event.target.closest('[data-wish]');if(wish){event.preventDefault();event.stopPropagation();toggleWishlist(Number(wish.dataset.wish));return;}const quick=event.target.closest('[data-quick]');if(quick){event.preventDefault();location.href=productHref({id:Number(quick.dataset.quick)});return;}});
cleanLegacySession();
shell();
loadInitialData();
