# Design System Specification: WhatsApp Archive Viewer

This design system supports a WhatsApp-style archive product, not a generic editorial chat workspace. The primary goal is familiarity: archived exports should feel like a living messaging app again, while still carrying a slightly more refined, archival presentation.

## 1. Overview & Creative North Star: "WhatsApp Familiar, Archive Calm"
The Creative North Star for this system is **WhatsApp Familiar, Archive Calm**.

The interface should immediately read as a messaging product:

- left conversation sidebar
- active transcript on the right
- left/right bubbles for real messages
- centered bubbles for historical WhatsApp events
- inline media previews that feel native to a chat surface

The product is still an archive, so the tone should remain calmer and more deliberate than consumer WhatsApp, but never so editorial that it stops feeling like a chat app.

---

## 2. Colors: Warm Archive Surface
We use warm paper-like neutrals with restrained greens so the UI feels close to WhatsApp without copying it outright.

### Separation Rule
Avoid hard app-chrome dividers when possible.

- Use background and tone shifts to separate sidebar, header, and transcript.
- Borders may be used sparingly inside cards, drawers, or modals, but the main chat split should feel soft rather than boxed in.

### Surface Hierarchy
Treat the product as layered paper and glass:

- Base app background: warm neutral gradient
- Sidebar shell: darker or denser surface to anchor navigation
- Transcript stage: lighter surface with subtle patterned wallpaper
- Floating media viewer or modal: darkest surface in the system

### Accent Usage
- Green remains the primary action and “sent message” accent.
- Warm orange can be used for sender accents or subtle highlights.
- Search and media affordances should feel visible but not neon.

---

## 3. Typography: Clear Over Clever
Typography should privilege scanability and chat familiarity.

- Headings may be expressive, but transcript text and metadata must stay highly readable.
- Sender names, timestamps, chat titles, and import actions should establish hierarchy quickly.
- Avoid turning the product into a magazine layout; message reading speed matters more than editorial flourish.

---

## 4. Core Components

### Message Bubbles
- Outgoing and incoming messages should still feel like chat bubbles first.
- Outgoing messages should use the strongest green tint in the interface.
- Incoming messages should stay bright and neutral.
- Bubble spacing should let the transcript breathe without losing conversational rhythm.

### Historical Event Bubbles
- Encryption notices, contact notices, and call history should render as centered neutral pills.
- Event bubbles should feel clearly distinct from authored messages but still native to the transcript.
- Event styling should be visually quieter than actual chat bubbles.

### Inline Media
- Photos should appear as image tiles inside the message bubble flow.
- Videos should show a preview tile with a clear play affordance.
- Stickers should be visually lighter and may use transparent or softly textured backing.
- GIFs and animated stickers should read as media, not as generic file attachments.

### Chat List Items
- The conversation list should feel close to WhatsApp navigation.
- Active rows need strong contrast and immediate recognizability.
- Search matches may use subtle badges or state cues, but should not overpower the row.

### Import Action
- Import belongs in the sidebar because archive ingestion is part of navigation, not a separate dashboard.
- The action should feel important, but it should not visually dominate the conversation list.

### Search Bars
- Search is global by default.
- It should visually read as “search all chats,” not “filter just this page.”
- It belongs near the top of the sidebar, above the conversation list.

### Fullscreen Media Viewer
- Clicking media should open an immersive viewer that isolates the asset from the transcript.
- Images and stickers should scale cleanly without decorative clutter.
- Videos should prioritize playback and controls over framing.

---

## 5. Do’s and Don’ts

### Do
- Do preserve familiar WhatsApp interaction patterns wherever archive constraints allow.
- Do make historical events feel intentionally different from authored messages.
- Do make inline media feel first-class, especially for photos, videos, stickers, and GIFs.
- Do keep the left sidebar practical: import, search, settings, and chat navigation should all be easy to scan.

### Don't
- Don't drift into a generic “editorial workspace” look that stops resembling a messaging app.
- Don't style historical events like ordinary sender messages.
- Don't reduce media to plain filename chips when the browser can preview it inline.
- Don't reintroduce a separate archive dashboard as the main browsing experience.

### Accessibility Note
Ensure message bubbles, centered events, sidebar states, and media controls maintain clear contrast and usable focus states. The transcript must remain readable for long sessions, not just visually distinctive in screenshots.
