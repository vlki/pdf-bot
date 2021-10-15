var path = require("path");
var htmlPdf = require("html-pdf-chrome");
var uuid = require("uuid");
var debug = require("debug")("pdf:generator");
var error = require("./error");
var uuid = require("uuid");
var utils = require("./utils");
var puppeteer = require("puppeteer");

function createPdfGenerator(storagePath, options = {}, storagePlugins = {}) {
  return function createPdf(url, job) {
    debug("Creating PDF for url %s using puppeteer", url);

    var generationId = uuid();
    var generated_at = utils.getCurrentDateTimeAsString();
    var jobId = job.id;

    function createResponseObject() {
      return {
        id: generationId,
        generated_at: generated_at,
      };
    }

    var pdfPath = path.join(storagePath, "pdf", uuid() + ".pdf");

    // Browser is using 96 PPI
    const inchesToPixels = (inches) => inches * 96;

    return (async () => {
      const browser = await puppeteer.launch({
        defaultViewport: {
          width: inchesToPixels(8.5), // = short side of US letter paper
          height: inchesToPixels(11), // long side of US letter paper
        },
      });

      const page = await browser.newPage();

      await page.goto(url, {
        waitUntil: "networkidle2",
      });

      // Add margins to the page
      await page.evaluate(
        () =>
          (document.documentElement.style =
            "position:absolute;top:0.4in;right:0.4in;left:0.4in;")
      );

      // Measure height of the rendered document
      const measuredHeight = await page.evaluate(() => {
        var traedePdfEl = document.getElementById("traede-pdf");

        return traedePdfEl ? traedePdfEl.getBoundingClientRect().height : null;
      });

      // Remove margins from the page
      await page.evaluate(() => (document.documentElement.style = ""));

      let scale = 1;

      const onePageHeight = inchesToPixels(11 - 0.4);
      if (measuredHeight !== null) {
        const diff = measuredHeight - onePageHeight;

        debug(
          "Measured document height is %d px, difference from one page height is %d px",
          measuredHeight,
          diff
        );

        if (diff > 0 && diff < 100) {
          scale = onePageHeight / measuredHeight;

          // Over-downscale a bit because otherwise some items might get cut
          scale = scale - 0.03;
        }
      }

      debug("Using scale %d", scale);

      await page.pdf({
        path: pdfPath,
        format: "letter",
        scale,
        margin: {
          top: "0.4in",
          right: "0.4in",
          bottom: "0.4in",
          left: "0.4in",
        },
      });

      debug("Saving PDF to %s", pdfPath);

      await browser.close();

      var storage = {
        local: pdfPath,
      };
      var storagePluginPromises = [];
      for (var i in storagePlugins) {
        // Because i will change before the promise is resolved
        // we use a self executing function to inject the variable
        // into a different scope
        var then = (function (type) {
          return function (response) {
            return Object.assign(response, {
              type: type,
            });
          };
        })(i);

        storagePluginPromises.push(storagePlugins[i](pdfPath, job).then(then));
      }

      return await Promise.all(storagePluginPromises).then((responses) => {
        for (var i in responses) {
          var response = responses[i];

          storage[response.type] = {
            path: response.path,
            meta: response.meta || {},
          };
        }

        return Object.assign(createResponseObject(), {
          storage: storage,
        });
      });
    })();

    // return htmlPdf
    //   .create(url, options)
    //   .then((pdf) => {
    //     var pdfPath = path.join(storagePath, "pdf", uuid() + ".pdf");

    //     debug("Saving PDF to %s", pdfPath);

    //     return pdf.toFile(pdfPath).then(function (response) {
    //       var storage = {
    //         local: pdfPath,
    //       };
    //       var storagePluginPromises = [];
    //       for (var i in storagePlugins) {
    //         // Because i will change before the promise is resolved
    //         // we use a self executing function to inject the variable
    //         // into a different scope
    //         var then = (function (type) {
    //           return function (response) {
    //             return Object.assign(response, {
    //               type: type,
    //             });
    //           };
    //         })(i);

    //         storagePluginPromises.push(
    //           storagePlugins[i](pdfPath, job).then(then)
    //         );
    //       }

    //       return Promise.all(storagePluginPromises).then((responses) => {
    //         for (var i in responses) {
    //           var response = responses[i];

    //           storage[response.type] = {
    //             path: response.path,
    //             meta: response.meta || {},
    //           };
    //         }

    //         return Object.assign(createResponseObject(), {
    //           storage: storage,
    //         });
    //       });
    //     });
    //   })
    //   .catch((msg) => {
    //     var response = error.createErrorResponse(
    //       error.ERROR_HTML_PDF_CHROME_ERROR
    //     );

    //     response.message +=
    //       " " +
    //       msg +
    //       " (job ID: " +
    //       jobId +
    //       ". Generation ID: " +
    //       generationId +
    //       ")";

    //     return Object.assign(createResponseObject(), response);
    //   });
  };
}

module.exports = createPdfGenerator;
