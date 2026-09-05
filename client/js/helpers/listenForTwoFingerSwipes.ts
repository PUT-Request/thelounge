// onTwoFingerSwipe will be called with a cardinal direction ("n", "e", "s" or
// "w") as its only argument.
import distance from "./distance";

type TouchCenter = [number, number];

type TouchHistoryEntry = {
	center: TouchCenter;
	timestamp: number;
};

type SwipeDirection = "n" | "e" | "s" | "w";

/**
 * Listens for two-finger swipes and reports their cardinal direction.
 *
 * Registers passive `touchmove`/`touchend`/`touchcancel` handlers on
 * `document.body`. The internal touch history is captured per swipe and
 * always reset after `touchend`/`touchcancel` (even when the callback throws),
 * so overlapping gestures cannot leak state into each other.
 *
 * @param onTwoFingerSwipe Callback invoked with the swipe direction.
 */
function listenForTwoFingerSwipes(onTwoFingerSwipe: (direction: SwipeDirection) => void) {
	let history: TouchHistoryEntry[] = [];

	document.body.addEventListener(
		"touchmove",
		function (event) {
			if (event.touches.length !== 2) {
				return;
			}

			const a = event.touches.item(0);
			const b = event.touches.item(1);

			if (!a || !b) {
				return;
			}

			const timestamp = window.performance.now();
			const center: TouchCenter = [(a.screenX + b.screenX) / 2, (a.screenY + b.screenY) / 2];

			if (history.length > 0) {
				const last = history[history.length - 1];
				const centersAreEqual =
					last.center[0] === center[0] && last.center[1] === center[1];

				if (last.timestamp === timestamp || centersAreEqual) {
					// Touches with the same timestamps or center don't help us
					// see the speed of movement. Ignore them.
					return;
				}
			}

			history.push({timestamp, center});
		},
		{passive: true}
	);

	document.body.addEventListener(
		"touchend",
		function (event) {
			if (event.touches.length >= 2) {
				return;
			}

			try {
				const direction = getSwipe(history);

				if (direction) {
					onTwoFingerSwipe(direction);
				}
			} finally {
				history = [];
			}
		},
		{passive: true}
	);

	document.body.addEventListener(
		"touchcancel",
		function () {
			history = [];
		},
		{passive: true}
	);
}

// Returns the cardinal direction of the swipe or null if there is no swipe.
function getSwipe(hist: TouchHistoryEntry[]): SwipeDirection | null {
	// Speed is in pixels/millisecond. Must be maintained throughout swipe.
	const MIN_SWIPE_SPEED = 0.2;

	if (hist.length < 2) {
		return null;
	}

	for (let i = 1; i < hist.length; ++i) {
		const previous = hist[i - 1];
		const current = hist[i];

		// Guard against duplicate timestamps from coalesced touch events:
		// a zero delta would divide by zero and produce an infinite speed.
		if (current.timestamp === previous.timestamp) {
			continue;
		}

		const speed =
			distance(previous.center, current.center) /
			Math.abs(previous.timestamp - current.timestamp);

		if (speed < MIN_SWIPE_SPEED) {
			return null;
		}
	}

	return getCardinalDirection(hist[0].center, hist[hist.length - 1].center);
}

function getCardinalDirection([x1, y1]: TouchCenter, [x2, y2]: TouchCenter): SwipeDirection {
	// If θ is the angle of the vector then this is tan(θ)
	const tangent = (y2 - y1) / (x2 - x1);

	// All values of |tan(-45° to 45°)| are less than 1, same for 145° to 225°
	if (Math.abs(tangent) < 1) {
		return x1 < x2 ? "e" : "w";
	}

	return y1 < y2 ? "s" : "n";
}

export default listenForTwoFingerSwipes;
