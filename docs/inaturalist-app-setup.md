# iNaturalist Integration Notes

The live site currently uses public iNaturalist API reads only. That means no app secret or OAuth token is needed for the biodiversity popup.

## Current Site Behavior

- Species cards keep the curated MHTR list as the source of truth.
- The "iNaturalist" button fetches taxon details only when a visitor asks for them.
- The popup uses the public MHTR project context: `biodiversity-of-mhtr`.
- The site does not publish coordinates from iNaturalist responses.

This avoids fetching hundreds of thumbnails on page load and keeps the page friendly to iNaturalist rate limits.

## If Creating An iNaturalist Application

Use this only when the site needs authenticated features later, such as letting a logged-in user submit or manage observations.

- Name: `MHTR`
- URL: `https://mhtr.in`
- Redirect URI for production: `https://mhtr.in/inaturalist/callback/`
- Redirect URI for local testing, if iNaturalist allows it on your application: `http://localhost:8080/inaturalist/callback/`
- Confidential: leave unchecked for a browser-only/static Netlify site and use PKCE.
- Description: `Mukundara Hills Tiger Reserve biodiversity reference site using iNaturalist project data for public species context.`

If we later add authenticated features through Netlify Functions or another backend that can store secrets securely, then a confidential app can make sense.

After saving, keep the generated client ID. Do not put the client secret in frontend code, Git, Netlify public environment variables, or screenshots. For the current public-read integration, neither value is needed.

## Useful Public Endpoints

- Taxa lookup: `https://api.inaturalist.org/v1/taxa?q=Calotes%20versicolor&locale=en`
- Project observations for a taxon: `https://api.inaturalist.org/v1/observations?project_id=biodiversity-of-mhtr&taxon_id=31281`
- Project page: `https://www.inaturalist.org/projects/biodiversity-of-mhtr`
