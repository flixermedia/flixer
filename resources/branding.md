# 🎨 Flixer — Brand Guidelines & Color Palette

Official design specifications and color system for **Flixer**, an alternative media server branding heavily inspired by Jellyfin’s iconic neon aesthetic.

---

## 👁️ Brand Identity

Flixer’s visual identity balances a sleek dark cinematic experience with high-energy accent colors. It evolves Jellyfin’s signature violet-cyan palette into punchier **Electric Magenta** and **Neon Cyan** tones while grounding the UI in deep slate backgrounds.

---

## 🎨 Color Palette

### 1. Base Palette

|                                                                     Preview                                                                     | Role                  | Color Name      | Hex Code  | Purpose / Usage                                  |
| :---------------------------------------------------------------------------------------------------------------------------------------------: | :-------------------- | :-------------- | :-------- | :----------------------------------------------- |
| <span style="display:inline-block;width:18px;height:18px;border-radius:6px;background:#7C3AED;border:1px solid rgba(255,255,255,0.35);"></span> | **Primary Accent**    | Galactic Violet | `#7C3AED` | Primary buttons, active focus rings, key CTAs    |
| <span style="display:inline-block;width:18px;height:18px;border-radius:6px;background:#2563EB;border:1px solid rgba(255,255,255,0.35);"></span> | **Secondary Accent**  | Deep Space Blue | `#2563EB` | Secondary controls, badges, progress bars        |
| <span style="display:inline-block;width:18px;height:18px;border-radius:6px;background:#A78BFA;border:1px solid rgba(255,255,255,0.35);"></span> | **Highlight / Hover** | Nebula Glow     | `#A78BFA` | Hover states, tab indicators, mid-gradient tones |
| <span style="display:inline-block;width:18px;height:18px;border-radius:6px;background:#090B1A;border:1px solid rgba(255,255,255,0.35);"></span> | **Dark Background**   | Deep Galaxy     | `#090B1A` | Main application backdrop / viewport             |
| <span style="display:inline-block;width:18px;height:18px;border-radius:6px;background:#111827;border:1px solid rgba(255,255,255,0.35);"></span> | **Surface Base**      | Midnight Nebula | `#111827` | Cards, sidebars, modals, top navbar              |
| <span style="display:inline-block;width:18px;height:18px;border-radius:6px;background:#312E81;border:1px solid rgba(255,255,255,0.35);"></span> | **Surface Border**    | Cosmic Border   | `#312E81` | Borders, subtle dividers, inactive elements      |
|  <span style="display:inline-block;width:18px;height:18px;border-radius:6px;background:#E2E8F0;border:1px solid rgba(15,23,42,0.20);"></span>   | **Primary Text**      | Starlight White | `#E2E8F0` | Movie/Show titles, primary headings, active text |
| <span style="display:inline-block;width:18px;height:18px;border-radius:6px;background:#94A3B8;border:1px solid rgba(255,255,255,0.35);"></span> | **Secondary Text**    | Lunar Gray      | `#94A3B8` | Metadata, summaries, timestamps, labels          |

---

## 🖌️ Brand Gradients

Gradients should be used for hero banners, brand logos, active selection highlights, and call-to-action fills.

### Primary Brand Gradient

background: linear-gradient(135deg, #7C3AED 0%, #4F46E5 45%, #2563EB 100%);

### Card Selection Glow

background: radial-gradient(circle, rgba(124, 58, 237, 0.45) 0%, rgba(37, 99, 235, 0.12) 45%, rgba(9, 11, 26, 0) 70%);

---

## 💻 Code Tokens

### CSS Custom Properties

'''
:root {
/* Brand Accents */
--flixer-primary: #7c3aed;
--flixer-secondary: #2563eb;
--flixer-accent: #a78bfa;

/* Dark Surfaces */
--flixer-bg: #090b1a;
--flixer-surface: #111827;
--flixer-border: #312e81;

/* Typography */
--flixer-text-main: #e2e8f0;
--flixer-text-muted: #94a3b8;

/* Gradients */
--flixer-gradient-brand: linear-gradient(135deg, #7c3aed 0%, #4f46e5 45%, #2563eb 100%);
}
'''

### Tailwind CSS Color Extension

'''
module.exports = {
theme: {
extend: {
colors: {
flixer: {
bg: '#090B1A',
surface: '#111827',
border: '#312E81',
primary: '#7C3AED',
secondary: '#2563EB',
accent: '#A78BFA',
text: '#E2E8F0',
muted: '#94A3B8',
},
},
},
},
};
'''

---

## 📄 License

This branding system is free to use for personal themes, UI concepts, and community applications under the [MIT License](LICENSE).
