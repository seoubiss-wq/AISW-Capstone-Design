function parseOpenNowOnly(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return false;
}

function isPlaceOpenNow(place) {
  if (typeof place?.current_opening_hours?.open_now === "boolean") {
    return place.current_opening_hours.open_now;
  }

  if (typeof place?.opening_hours?.open_now === "boolean") {
    return place.opening_hours.open_now;
  }

  return false;
}

module.exports = {
  parseOpenNowOnly,
  isPlaceOpenNow,
};
