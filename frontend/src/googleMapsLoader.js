let bootstrapPromise;

export function ensureGoogleMapsLoaded(apiKey) {
  if (!apiKey) {
    return Promise.reject(new Error("REACT_APP_GOOGLE_MAPS_API_KEY is missing."));
  }

  if (window.google?.maps?.importLibrary) {
    return Promise.resolve(window.google.maps);
  }

  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = new Promise((resolve, reject) => {
    ((config) => {
      let scriptLoadingPromise;
      const googleNamespace = "google";
      const importLibraryName = "importLibrary";
      const callbackName = "__ib__";
      const doc = document;
      const win = window;
      const googleObject = (win[googleNamespace] = win[googleNamespace] || {});
      const mapsObject = (googleObject.maps = googleObject.maps || {});
      const requestedLibraries = new Set();
      const params = new URLSearchParams();

      const loadScript = () =>
        scriptLoadingPromise ||
        (scriptLoadingPromise = new Promise(async (resolveScript, rejectScript) => {
          const script = doc.createElement("script");

          params.set("libraries", [...requestedLibraries].join(","));
          Object.keys(config).forEach((key) => {
            params.set(
              key.replace(/[A-Z]/g, (match) => `_${match[0].toLowerCase()}`),
              config[key],
            );
          });

          params.set("callback", `${googleNamespace}.maps.${callbackName}`);
          script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
          mapsObject[callbackName] = resolveScript;
          script.onerror = () => rejectScript(new Error("Google Maps JavaScript API could not load."));
          doc.head.append(script);
        }));

      if (!mapsObject[importLibraryName]) {
        mapsObject[importLibraryName] = (library, ...rest) =>
          requestedLibraries.add(library) && loadScript().then(() => mapsObject[importLibraryName](library, ...rest));
      }
    })({
      key: apiKey,
      v: "weekly",
      language: "ko",
      region: "KR",
    });

    window.google.maps
      .importLibrary("maps")
      .then(() => resolve(window.google.maps))
      .catch(reject);
  });

  return bootstrapPromise;
}
