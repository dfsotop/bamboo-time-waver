# Time Weaver

https://documentation.bamboohr.com/reference/time-tracking use this api documentation to build an app that executes an scheduled task, every working day, at 10:00am (Europe/Madrid) to add an entry to the current day. Every entry should be in a randomized time, between a time range provided by the user. User must specify clockin and clock out time range. Before adding an entry, the app should check if there's already an entry (public holiday, vacation, sick leave, so to not add a duplicate entry).

App must ask the user for the api key and save it securely. 

App will ask the user to login using user, password. 

User can see a list of the execution history and re triggers a failed execution

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://rooster-ft.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/f313f4b4-282c-4e64-8a18-4d527f3da743).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
