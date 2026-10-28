/*
  The few Mac things Electron has no API for, as a Node-API addon the main process loads:
  the material behind the window's glass frame alone (vibrancy, or Liquid Glass on macOS 26+), where
  the traffic lights sit, the trackpad's tap, and keeping Apple Intelligence's badge off the
  page's text fields. Node-API is ABI-stable, so it builds against any Node's headers and loads
  in Electron. desktop/build.ts compiles it; without it the shell falls back to what Electron has.
*/
#import <AppKit/AppKit.h>
#include <node_api.h>

static NSString* const kBackdrop = @"liner.backdrop";

static NSView* viewArg(napi_env env, napi_value v) {
  void* data = nullptr;
  size_t len = 0;
  if (napi_get_buffer_info(env, v, &data, &len) != napi_ok || len < sizeof(void*)) return nil;
  return (__bridge NSView*)(*(void**)data);
}

static double numberOf(napi_env env, napi_value obj, const char* key) {
  napi_value v;
  double d = 0;
  if (napi_get_named_property(env, obj, key, &v) == napi_ok) napi_get_value_double(env, v, &d);
  return d;
}

/* obj[key], if it's an object. */
static bool objectOf(napi_env env, napi_value obj, const char* key, napi_value* out) {
  bool has = false;
  napi_valuetype t;
  if (napi_has_named_property(env, obj, key, &has) != napi_ok || !has) return false;
  if (napi_get_named_property(env, obj, key, out) != napi_ok || napi_typeof(env, *out, &t) != napi_ok) return false;
  return t == napi_object;
}

static NSString* stringArg(napi_env env, napi_value v) {
  char buf[64] = {0};
  size_t len = 0;
  if (napi_get_value_string_utf8(env, v, buf, sizeof buf, &len) != napi_ok) return @"";
  return [NSString stringWithUTF8String:buf];
}

static napi_value undefinedValue(napi_env env) {
  napi_value u;
  napi_get_undefined(env, &u);
  return u;
}

/*
  backdrop(handle, material, frame): what sits behind the transparent page. The window stays
  opaque with the system's window colour, so macOS composites only what's in it; vibrancy or
  Liquid Glass shows the desktop through the window's glass frame (frame, in the page's top-left
  points: the sidebar and the gaps around the paper) and nowhere else. frame.hole is the paper,
  with its corner radius: the material's mask leaves it out, so nothing is blurred under the
  paper. A live material behind the whole window kept WindowServer's GPU busy whenever anything
  behind it moved, so Electron's own full-window vibrancy view, which only serves to make the
  page transparent, stays hidden.
*/
static NSImage* frameMask(NSSize size, NSRect hole, CGFloat radius) {
  return [NSImage imageWithSize:size flipped:YES drawingHandler:^BOOL(NSRect r) {
    [NSColor.blackColor setFill];
    NSRectFill(r);
    if (hole.size.width >= 1 && hole.size.height >= 1) {
      [NSGraphicsContext.currentContext setCompositingOperation:NSCompositingOperationClear];
      [[NSBezierPath bezierPathWithRoundedRect:hole xRadius:radius yRadius:radius] fill];
    }
    return YES;
  }];
}

static napi_value Backdrop(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 3) return undefinedValue(env);
  NSView* content = viewArg(env, argv[0]);
  NSWindow* window = content.window;
  if (!content || !window) return undefinedValue(env);
  NSString* material = stringArg(env, argv[1]);
  NSRect r = NSMakeRect(numberOf(env, argv[2], "x"), numberOf(env, argv[2], "y"), numberOf(env, argv[2], "width"), numberOf(env, argv[2], "height"));
  // The paper, relative to the frame's own top left.
  NSRect hole = NSZeroRect;
  CGFloat radius = 0;
  napi_value h;
  if (objectOf(env, argv[2], "hole", &h)) {
    hole = NSMakeRect(numberOf(env, h, "x") - r.origin.x, numberOf(env, h, "y") - r.origin.y, numberOf(env, h, "width"), numberOf(env, h, "height"));
    radius = numberOf(env, h, "radius");
  }

  window.opaque = YES;
  window.backgroundColor = NSColor.windowBackgroundColor;
  NSView* ours = nil;
  for (NSView* v in content.subviews) {
    if ([v.identifier hasPrefix:kBackdrop]) ours = v;
    else if ([v isKindOfClass:NSVisualEffectView.class]) v.hidden = YES;
  }
  // Liquid Glass needs macOS 26; before that it's vibrancy.
  Class glassClass = NSClassFromString(@"NSGlassEffectView");
  BOOL live = [material isEqualToString:@"vibrancy"] || [material isEqualToString:@"glass"];
  BOOL glass = [material isEqualToString:@"glass"] && glassClass != nil;
  NSString* kind = [kBackdrop stringByAppendingString:glass ? @".glass" : @".vibrancy"];
  if (ours && (!live || ![ours.identifier isEqualToString:kind])) {
    [ours removeFromSuperview];
    ours = nil;
  }
  if (!live) return undefinedValue(env);

  NSVisualEffectView* fx = nil;
  if (!ours) {
    fx = [[NSVisualEffectView alloc] init];
    fx.material = NSVisualEffectMaterialSidebar;
    fx.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    fx.state = NSVisualEffectStateFollowsWindowActiveState;
    ours = fx;
    if (glass) {
      // The vibrancy shows the desktop; the glass on top of it gives the rim and lensing.
      NSView* g = [[glassClass alloc] init];
      [g setValue:@1 forKey:@"style"];  // NSGlassEffectViewStyleClear
      [g setValue:@0 forKey:@"cornerRadius"];
      [g setValue:fx forKey:@"contentView"];
      ours = g;
    }
    ours.identifier = kind;
    [content addSubview:ours positioned:NSWindowBelow relativeTo:nil];
  } else {
    fx = [ours isKindOfClass:NSVisualEffectView.class] ? (NSVisualEffectView*)ours : [ours valueForKey:@"contentView"];
  }
  CGFloat height = content.bounds.size.height;
  ours.hidden = r.size.width < 1 || r.size.height < 1;
  ours.frame = NSMakeRect(r.origin.x, content.isFlipped ? r.origin.y : height - r.origin.y - r.size.height, r.size.width, r.size.height);
  ours.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  if ([fx isKindOfClass:NSVisualEffectView.class]) fx.maskImage = frameMask(r.size, hole, radius);
  if (ours != fx) {
    // Liquid Glass draws its own surface: it takes the same shape from a layer mask.
    ours.wantsLayer = YES;
    CALayer* m = [CALayer layer];
    m.frame = NSMakeRect(0, 0, r.size.width, r.size.height);
    m.contents = fx.maskImage;
    m.contentsGravity = kCAGravityResize;
    ours.layer.mask = m;
  }
  return undefinedValue(env);
}

/*
  lights(handle) → { x, y }: y is the traffic lights' centre from the top, x where they end
  (0 in full screen, where they're hidden), so the page's sidebar name lines up with them.
*/
static napi_value Lights(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  NSView* content = argc ? viewArg(env, argv[0]) : nil;
  NSWindow* window = content.window;
  NSButton* close = [window standardWindowButton:NSWindowCloseButton];
  NSButton* zoom = [window standardWindowButton:NSWindowZoomButton];
  if (!close || !zoom || !close.superview) return undefinedValue(env);
  NSRect c = [close.superview convertRect:close.frame toView:nil];
  NSRect z = [zoom.superview convertRect:zoom.frame toView:nil];
  BOOL full = (window.styleMask & NSWindowStyleMaskFullScreen) != 0;
  CGFloat height = window.contentView.bounds.size.height;
  napi_value out, x, y;
  napi_create_object(env, &out);
  napi_create_int32(env, (int)lround(height - NSMidY(c)), &y);
  napi_create_int32(env, full ? 0 : (int)lround(NSMaxX(z)), &x);
  napi_set_named_property(env, out, "x", x);
  napi_set_named_property(env, out, "y", y);
  return out;
}

static napi_value Haptic(napi_env env, napi_callback_info info) {
  [[NSHapticFeedbackManager defaultPerformer] performFeedbackPattern:NSHapticFeedbackPatternGeneric performanceTime:NSHapticFeedbackPerformanceTimeNow];
  return undefinedValue(env);
}

/*
  macOS 27 floats an Apple Intelligence badge (its "lightweight UI" window) over any focused
  text field, and offers no switch for it. The composer is a chat with an agent, where it's in
  the way, so whenever AppKit puts it up, it goes away again.
*/
static id badgeObserver = nil;
static napi_value QuietWritingBadge(napi_env env, napi_callback_info info) {
  if (badgeObserver) return undefinedValue(env);
  badgeObserver = [[NSNotificationCenter defaultCenter] addObserverForName:NSApplicationDidUpdateNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification* note) {
    for (NSWindow* w in NSApp.windows) {
      if (w.isVisible && [NSStringFromClass(w.class) containsString:@"LightweightUIHostWindow"]) {
        w.alphaValue = 0;
        w.ignoresMouseEvents = YES;
        [w orderOut:nil];
      }
    }
  }];
  return undefinedValue(env);
}

NAPI_MODULE_INIT() {
  const struct { const char* name; napi_callback fn; } fns[] = {
    {"backdrop", Backdrop}, {"lights", Lights}, {"haptic", Haptic}, {"quietWritingBadge", QuietWritingBadge},
  };
  for (const auto& f : fns) {
    napi_value v;
    napi_create_function(env, f.name, NAPI_AUTO_LENGTH, f.fn, nullptr, &v);
    napi_set_named_property(env, exports, f.name, v);
  }
  return exports;
}
