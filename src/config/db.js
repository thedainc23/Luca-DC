const admin = require("firebase-admin");

const serviceAccount = {
    "type": "service_account",
    "project_id": "dreamcatchers-test",
    "private_key_id": "2f527a9a90b66f20b1d74dadb5e10326c3dc8a22",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC9fMlN5NEqfd86\nCQE6CsXPMse8PUAJLWhXOgqVaGImKz+Y2IAAJyV3nWRaCQ8t4eU98FE+cSNUKzHS\nNGtBAVMsSjyfOt4sUD4CnpkK2eccHw6mB3cbIwT2CCwewgCX9Q1xff9NRuupG2RF\nmNk67dvlOxN5jrPVd6KUDcSn45zUDOVMAUmNEJU7D8PkyWmZjtX3dCV/BwPtCeUX\n3WETiMWdgO3gzMdy1oFO+df/5v7Udx46z34wSQtgyZDdx4KXQrt1pwqe7lD24nPo\nK5hXmblpCcm8c9ZgxMHu0bVBbVfaE+WKeo5eN6GOIlRbTlMe5yqQevJPmhFxIU+I\nyOn00dBXAgMBAAECggEADauqjvhCpOj8NAuBRKbmpYUEMaRORzs462Nwbwi0XWJC\nY4G/HlkJ/sq3+jeWxO3RZE9ptR0Oz5w8KxkFYeUOve5vLY0JiV3n/g1jfOEX/N3l\naHy3uZlPBXxfySpK8QDzeCwpwUasFYEN52gtx+7Fg2YTM3JkWV1uY8sTKd+l1Aso\nCzwOkQ0/lReDROJrAVjXbAkFq32++CeS662v7v/xMX/wQg09rjqTLRplXTdF/ewj\nW3GTKVuk5hq2aOW4Y/OvtDcxOeSUHXH8lhnYOqJBHVYwiTCL95y6iHsQIobYurOs\nbUhTlK+8FfxXv1/E5czVTgw4ZRTAiscCDFlT3k9aPQKBgQD9IsXcmNONKBivJUyC\n/CNuvLOX8FA8ELkltaGYqB4qb4zagrSVZUsFKdeC3T9RB1FFNBg+5GeAXuR6XMyD\nkYh/W4yryWcE2BvJiC9E90yrXzfRvxVTeCI49MrPJ8IkThXOfW9aHmbJICgMakC4\nuitjpO1mowk1Lj9jsOXj5kll5QKBgQC/oaatQwJjAgWnOJaGmE1gBFvhPqYwFVp2\nWS+KVXV6hBkIYs4YsDJMKge7VZsPrGJIsWg++/UhCz8lYNtzcum11MTKZRCT+f0t\nanBo5kDQX3V685weSIM7cNJkLYW8+D+5Idkn3iRGZsDbrcLAvdB2liPXo6kJsfbk\nr6D06bG5iwKBgQDhFx6iPjM/fbwVYjFa+CH5wkpgfQybnLNGWPBM8pGAYpj5ZOh3\nQA8plD9S2rIGt18JDn3QzwFKIRdBx2sEQ1EBDsNTrk+w+woadsKxrMW8TXsxQ50P\nD/A+fU4qTsxPxC+X4eo2VHpJthJml8Tdfo4+mNWRQsBZTbqIRzDlKk1yEQKBgC23\nj/8X1HLwYY7iVi7oGNWGVLEo9BbWkU1Yu5nCB5Ph/eLdR5PmPSmkgVG0+5hCpPP4\ntwkHrRRkDX2KXPBvAsipaQVsFQdohXkXQpgUDnRnwaxCgAVNgVll8huKLLTHeNRe\n+eKkAX12OB5wltzKq/gOm6BvX/17Io6uQ7UKJ6c/AoGBAJ4k9zI6O9FuAYxVCQPS\nNdrIrX21Xljjkz8jDmevbpk5eN6lK7ZriUbtlBp3V3WS2rOZramRC34mm297emaU\nz/lLsQ0hpmxWX43ZXDbU1zBANMXqFjIgSNjSJ7WQrN8kpIw+V55RKLJfI3r2LQ2V\nhOIbFuXjLLi8Qx5cSATnMCny\n-----END PRIVATE KEY-----\n",
    "client_email": "firebase-adminsdk-fbsvc@dreamcatchers-test.iam.gserviceaccount.com",
    "client_id": "113996518534410783446",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40dreamcatchers-test.iam.gserviceaccount.com",
    "universe_domain": "googleapis.com"
  };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
console.log("🔥 Firebase Initialized");

module.exports = db;