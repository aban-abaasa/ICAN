# 🎨 ICAN Landing Page - Customization Guide

## Quick Start Configuration

### 1. Change Brand Colors

Edit these color classes throughout `LandingPage.jsx`:

```jsx
// Primary gradient (change these two colors)
from-purple-400 to-pink-400  // Title gradients
from-purple-500 to-pink-500  // Buttons and accents

// Secondary gradients
from-blue-400  // Secondary text
from-pink-400  // Tertiary text
```

**Tailwind Color Options:**
- `purple`, `pink`, `blue`, `green`, `red`, `orange`, `yellow`, `indigo`, `cyan`, `teal`

### 2. Customize Dashboard Preview

Edit `src/components/DashboardPreview.jsx`:

```jsx
// Change stat card titles and values
<span className="text-gray-400 text-sm">Total Balance</span>
<p className="text-2xl font-bold text-purple-300">$24,580</p>

// Change stat colors (one per card)
text-purple-300  // Balance
text-pink-300    // Transactions
text-blue-300    // Groups
text-green-300   // Portfolio
```

### 3. Add/Remove Platform Slides

In `LandingPage.jsx`, modify the `slides` array:

```jsx
const slides = [
  {
    image: '/images/your-image.png',  // Add your image
    title: 'Your Platform Name',       // Change title
    description: 'Your description here',
    features: ['Feature 1', 'Feature 2', 'Feature 3']
  }
  // Add or remove items as needed
];
```

**Note:** Images must be placed in `frontend/public/images/` folder.

### 4. Update Feature Cards

In the Features Section, modify the `features` array:

```jsx
const features = [
  {
    icon: <YourIcon className="w-8 h-8" />,
    title: 'Your Feature Title',
    description: 'Your feature description here'
  }
  // Add or remove features
];
```

**Available Icons from lucide-react:**
- `Zap`, `Shield`, `TrendingUp`, `Users`, `Lock`, `Zap`, `Eye`, `Send`, `Plus`, `Activity`

### 5. Customize Testimonials

In `LandingPage.jsx`, modify the `testimonials` array:

```jsx
const testimonials = [
  {
    name: 'Person Name',
    role: 'Their Role',
    text: 'Their testimonial quote here',
    avatar: '👩‍💼'  // Use emoji or initials
  }
  // Add or remove testimonials
];
```

## 🎬 Animation Customization

### Adjust Animation Speeds

Edit in `src/index.css`:

```css
@keyframes fadeInUp {
  animation: fadeInUp 0.8s ease-out;  /* Change 0.8s */
}

@keyframes float {
  animation: float 3s ease-in-out infinite;  /* Change 3s */
}

@keyframes blob {
  animation: blob 7s infinite;  /* Change 7s */
}
```

### Adjust Carousel Auto-Rotate

In `LandingPage.jsx`:

```jsx
useEffect(() => {
  const interval = setInterval(() => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  }, 5000);  // Change 5000 (milliseconds) - e.g., 3000 for 3 seconds
  return () => clearInterval(interval);
}, []);
```

### Background Blob Speed

In the JSX, modify the `animate-blob` classes:

```jsx
<div className="animate-blob"></div>  // 7s animation
<div className="animate-blob animation-delay-2000"></div>  // Delay 2s
<div className="animate-blob animation-delay-4000"></div>  // Delay 4s
```

## 📱 Responsive Layout Changes

### Adjust Grid Columns

Find grid definitions and modify:

```jsx
// Features section - change md:grid-cols-4 to md:grid-cols-2 or md:grid-cols-3
<div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">

// Testimonials - change md:grid-cols-3 to md:grid-cols-2
<div className="grid md:grid-cols-3 gap-6">
```

### Adjust Section Padding

Change spacing values:

```jsx
<section className="py-20 px-4">  // py-20 = padding-y, px-4 = padding-x
// Options: py-8, py-12, py-16, py-20, py-24, py-32
```

## 🎯 Text Content Changes

### Update Navigation Links

In the Navigation section:

```jsx
<a href="#features" className="hover:text-purple-400 transition">Features</a>
<a href="#platforms" className="hover:text-purple-400 transition">Platforms</a>
<a href="#testimonials" className="hover:text-purple-400 transition">Testimonials</a>
```

### Update Hero Title

```jsx
<h1 className="text-5xl md:text-6xl font-bold leading-tight">
  <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
    Revolutionize  {/* Change this text */}
  </span>
  <br />
  Your Financial Journey  {/* And this text */}
</h1>
```

### Update Hero Description

```jsx
<p className="text-xl text-gray-300 leading-relaxed">
  ICAN is a comprehensive capital engine platform... {/* Change this */}
</p>
```

### Update Stats

```jsx
<div>
  <p className="text-3xl font-bold text-purple-400">10K+</p>  {/* Change numbers */}
  <p className="text-gray-400">Active Users</p>  {/* Change label */}
</div>
```

## 🔧 Component Integration

### Change CTA Button Action

The `onGetStarted` prop is passed from App.jsx:

```jsx
// In App.jsx
<LandingPage onGetStarted={() => setShowLanding(false)} />
```

### Update Footer Links

In Footer section:

```jsx
<li><a href="/your-path" className="hover:text-purple-400 transition">Your Link</a></li>
```

## 📝 Section Configuration

### Hero Section Stats
- **Location:** Lines ~120-140
- **Customize:** Number, label, color

### Platform Carousel
- **Location:** Lines ~200-250
- **Customize:** Slides array, auto-rotate timing

### Features Grid
- **Location:** Lines ~260-290
- **Customize:** Features array, icons, descriptions

### Testimonials
- **Location:** Lines ~340-370
- **Customize:** Testimonials array, avatars

### CTA Section
- **Location:** Lines ~400-415
- **Customize:** Heading, description, button text

## 🎨 Shadow and Border Effects

### Modify Card Hover Effects

```jsx
className="hover:shadow-lg hover:shadow-purple-500/50 transition"
// Change color: purple-500 → pink-500, blue-500, etc.
// Change intensity: /50 → /20, /30, /70, etc.
```

### Modify Border Colors

```jsx
border border-purple-500/30  // opacity 30%
// Change: /30 → /10, /20, /40, /50, etc.
// Change color: purple-500 → pink-500, blue-500, etc.
```

## 🌟 Advanced Customizations

### Add More Carousel Slides
1. Add image to `public/images/`
2. Add object to `slides` array in `LandingPage.jsx`
3. Carousel automatically adjusts

### Add Custom Font
1. Add to `index.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Your+Font:wght@300;400;600;700&display=swap');
```
2. Update in `body`:
```css
font-family: 'Your Font', system-ui, -apple-system, sans-serif;
```

### Add Scroll Animations
1. Add intersection observer in `useEffect`
2. Trigger animations on scroll
3. Add corresponding CSS animations in `index.css`

## 🔍 Troubleshooting

**Animations not working?**
- Check `src/index.css` has all animation definitions
- Clear browser cache
- Verify Tailwind CSS is properly configured

**Images not showing?**
- Check file names in `public/images/` folder
- Verify URL encoding for spaces: `%20`
- Check browser console for 404 errors

**Colors not changing?**
- Ensure you're using valid Tailwind colors
- Clear Next.js cache if using Next.js
- Do full refresh (Ctrl+Shift+R)

## 📚 Tailwind CSS Reference

### Common Classes Used
- `text-{color}-{shade}`: Text color (e.g., `text-purple-400`)
- `bg-{color}-{shade}`: Background color
- `border-{color}-{shade}`: Border color
- `from-{color}-{shade}`: Gradient start
- `to-{color}-{shade}`: Gradient end
- `py-{size}`: Padding vertical (8, 12, 16, 20, 24, 32)
- `px-{size}`: Padding horizontal
- `grid-cols-{number}`: Grid columns (1-12)
- `md:`, `lg:`: Responsive modifiers

### Opacity
- `/10`, `/20`, `/30`, `/40`, `/50`, `/60`, `/70`, `/80`, `/90`

## 💡 Pro Tips

1. **Test responsive design:** Use browser DevTools to test mobile/tablet/desktop views
2. **Check contrast:** Ensure text is readable on all backgrounds
3. **Keep it light:** Too many animations can slow down loading
4. **Use consistent colors:** Stick to 2-3 main colors + neutrals
5. **Mobile first:** Test mobile layout first, then expand
6. **Performance:** Monitor animations with DevTools Performance tab

## 📞 Support

For issues or questions:
1. Check the main `LANDING_PAGE_README.md`
2. Review the customization examples above
3. Test in browser DevTools console for errors
4. Verify all file paths are correct

---

**Version:** 1.0
**Last Updated:** January 2026
