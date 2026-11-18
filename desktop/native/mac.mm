/*
  The few Mac things Electron has no API for, as a Node-API addon the main process loads:
  the window see-through to the desktop, crisp or blurred (Background: Desktop), where the traffic
  lights sit, the trackpad's tap, and keeping Apple Intelligence's badge off the page's text fields. Node-API is ABI-stable, so it builds against any Node's headers and loads
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
  backdrop(handle, material): what sits behind the transparent page. solid keeps the window opaque
  with the system's window colour, so macOS composites only what's in it. Electron's own
  full-window vibrancy view, which only serves to make the page transparent, stays hidden: a live
  material behind the whole window keeps WindowServer's GPU busy whenever anything behind it moves.
  clear and frost are the desktop behind the whole window (Background: Desktop): the window turns
  transparent and the page tints itself. clear has no material at all, so WindowServer only blends
  the window over what's behind, which costs next to nothing; frost puts a blur behind the whole
  window, and that one does cost the GPU whenever something behind it moves.
*/
static napi_value Backdrop(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) return undefinedValue(env);
  NSView* content = viewArg(env, argv[0]);
  NSWindow* window = content.window;
  if (!content || !window) return undefinedValue(env);
  NSString* material = stringArg(env, argv[1]);

  BOOL frost = [material isEqualToString:@"frost"];
  BOOL see = frost || [material isEqualToString:@"clear"];
  BOOL turned = window.opaque == see;
  window.opaque = !see;
  window.backgroundColor = see ? NSColor.clearColor : NSColor.windowBackgroundColor;
  // A clear window's shadow follows what's drawn in it, which changes with the page's tint, blur or
  // none, and the opacity itself: worked out again a moment after each call, once the page has
  // painted, and once for a run of calls (a slider dragged sends one per step).
  [NSObject cancelPreviousPerformRequestsWithTarget:window selector:@selector(invalidateShadow) object:nil];
  if (see || turned) [window performSelector:@selector(invalidateShadow) withObject:nil afterDelay:0.25];
  NSView* ours = nil;
  for (NSView* v in content.subviews) {
    if ([v.identifier hasPrefix:kBackdrop]) ours = v;
    else if ([v isKindOfClass:NSVisualEffectView.class]) v.hidden = YES;
  }
  NSString* kind = [kBackdrop stringByAppendingString:@".frost"];
  if (ours && (!frost || ![ours.identifier isEqualToString:kind])) {
    [ours removeFromSuperview];
    ours = nil;
  }
  if (!frost) return undefinedValue(env);

  if (!ours) {
    NSVisualEffectView* fx = [[NSVisualEffectView alloc] init];
    fx.material = NSVisualEffectMaterialUnderWindowBackground;
    fx.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    // The desktop stays blurred behind the window when it's in the background too: following the
    // window's state would turn it to a flat grey whenever another app is in front.
    fx.state = NSVisualEffectStateActive;
    fx.identifier = kind;
    ours = fx;
    [content addSubview:ours positioned:NSWindowBelow relativeTo:nil];
  }
  // The whole window, following its size, with nothing masked out.
  ours.hidden = NO;
  ours.frame = content.bounds;
  ours.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
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
