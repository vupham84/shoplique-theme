import { Component } from '@theme/component';
import {
  VariantSelectedEvent,
  VariantUpdateEvent,
} from '@theme/events';
import { morph } from '@theme/morph';

/**
 * A custom element that manages a variant picker.
 *
 * @template {import('@theme/component').Refs} [Refs = {}]
 *
 * @extends Component<Refs>
 */
export default class VariantPicker extends Component {
  /** @type {string | undefined} */
  #pendingRequestUrl;

  /** @type {AbortController | undefined} */
  #abortController;

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener('change', this.variantChanged.bind(this));
  }

  /**
   * Handles the variant change event.
   * @param {Event} event - The variant change event.
   */
  variantChanged(event) {
    if (!(event.target instanceof HTMLElement)) return;

    this.updateSelectedOption(event.target);
    this.dispatchEvent(new VariantSelectedEvent({ id: event.target.dataset.optionValueId ?? '' }));

    const isOnProductPage =
      Theme.template.name === 'product' &&
      !event.target.closest('product-card') &&
      !event.target.closest('quick-add-dialog');

    // Morph the entire main content for combined listings child products, because changing the product
    // might also change other sections depending on recommendations, metafields, etc.
    const currentUrl = this.dataset.productUrl?.split('?')[0];
    const newUrl = event.target.dataset.connectedProductUrl;
    const loadsNewProduct = isOnProductPage && !!newUrl && newUrl !== currentUrl;

    this.fetchUpdatedSection(this.buildRequestUrl(event.target), loadsNewProduct);

    const url = new URL(window.location.href);

    let variantId;

    if (event.target instanceof HTMLInputElement && event.target.type === 'radio') {
      variantId = event.target.dataset.variantId || null;
    } else if (event.target instanceof HTMLSelectElement) {
      const selectedOption = event.target.options[event.target.selectedIndex];
      variantId = selectedOption?.dataset.variantId || null;
    }

    if (isOnProductPage) {
      if (variantId) {
        url.searchParams.set('variant', variantId);
      } else {
        url.searchParams.delete('variant');
      }
    }

    // Change the path if the option is connected to another product via combined listing.
    if (loadsNewProduct) {
      url.pathname = newUrl;
    }

    if (url.href !== window.location.href) {
      history.replaceState({}, '', url.toString());
    }
  }

  /**
   * Updates the selected option.
   * @param {string | Element} target - The target element.
   */
  updateSelectedOption(target) {
    if (typeof target === 'string') {
      const targetElement = this.querySelector(`[data-option-value-id="${target}"]`);

      if (!targetElement) throw new Error('Target element not found');

      target = targetElement;
    }

    if (target instanceof HTMLInputElement) {
      target.checked = true;
    }

    if (target instanceof HTMLSelectElement) {
      const newValue = target.value;
      const newSelectedOption = Array.from(target.options).find((option) => option.value === newValue);

      if (!newSelectedOption) throw new Error('Option not found');

      for (const option of target.options) {
        option.removeAttribute('selected');
      }

      newSelectedOption.setAttribute('selected', 'selected');
    }
  }

  /**
   * Builds the request URL.
   * @param {HTMLElement} selectedOption - The selected option.
   * @param {string | null} [source] - The source.
   * @param {string[]} [sourceSelectedOptionsValues] - The source selected options values.
   * @returns {string} The request URL.
   */
  buildRequestUrl(selectedOption, source = null, sourceSelectedOptionsValues = []) {
    // this productUrl and pendingRequestUrl will be useful for the support of combined listing. It is used when a user changes variant quickly and those products are using separate URLs (combined listing).
    // We create a new URL and abort the previous fetch request if it's still pending.
    let productUrl = selectedOption.dataset.connectedProductUrl || this.#pendingRequestUrl || this.dataset.productUrl;
    this.#pendingRequestUrl = productUrl;
    const params = [];

    if (this.selectedOptionsValues.length && !source) {
      params.push(`option_values=${this.selectedOptionsValues.join(',')}`);
    } else if (source === 'product-card') {
      if (this.selectedOptionsValues.length) {
        params.push(`option_values=${sourceSelectedOptionsValues.join(',')}`);
      } else {
        params.push(`option_values=${selectedOption.dataset.optionValueId}`);
      }
    }

    // If variant-picker is a child of quick-add-component or swatches-variant-picker-component, we need to append section_id=section-rendering-product-card to the URL
    if (this.closest('quick-add-component') || this.closest('swatches-variant-picker-component')) {
      if (productUrl?.includes('?')) {
        productUrl = productUrl.split('?')[0];
      }
      return `${productUrl}?section_id=section-rendering-product-card&${params.join('&')}`;
    }
    return `${productUrl}?${params.join('&')}`;
  }

  /**
   * Fetches the updated section.
   * @param {string} requestUrl - The request URL.
   * @param {boolean} shouldMorphMain - If the entire main content should be morphed. By default, only the variant picker is morphed.
   */
  fetchUpdatedSection(requestUrl, shouldMorphMain = false) {
    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    fetch(requestUrl, { signal: this.#abortController.signal })
      .then((response) => response.text())
      .then((responseText) => {
        this.#pendingRequestUrl = undefined;
        const html = new DOMParser().parseFromString(responseText, 'text/html');
        // Defer is only useful for the initial rendering of the page. Remove it here.
        html.querySelector('overflow-list[defer]')?.removeAttribute('defer');

        const textContent = html.querySelector(`variant-picker script[type="application/json"]`)?.textContent;
        if (!textContent) return;

        if (shouldMorphMain) {
          this.updateMain(html);
        } else {
          const newProduct = this.updateVariantPicker(html);

          // --- PATCH: Scoped update for promotion-callout section ---
          const quickAddOpenModal = document.querySelector('.quick-add-modal[open]');
          const context = quickAddOpenModal ? quickAddOpenModal : this.closest('.product-card, product-form, main');
          const currentPromotion = context?.querySelector('.product-promotion-callout');
          const newPromotion = html.querySelector('.product-promotion-callout');
          if (currentPromotion && newPromotion) {
            morph(currentPromotion, newPromotion);
            if (currentPromotion instanceof HTMLElement) {
              currentPromotion.style.display = ''; // Ensure visibility after morph
            }
          } else if (currentPromotion && !newPromotion) {
            // Hide promotion callout if not present in new HTML
            if (currentPromotion instanceof HTMLElement) {
              currentPromotion.style.display = 'none';
            }
          }
          // --- END PATCH ---

          // We grab the variant object from the response and dispatch an event with it.
          if (this.selectedOptionId) {
            this.dispatchEvent(
              new VariantUpdateEvent(JSON.parse(textContent), this.selectedOptionId, {
                html,
                productId: this.dataset.productId ?? '',
                newProduct,
              })
            );
          }
        }
      })
      .catch((error) => {
        if (error.name === 'AbortError') {
          console.log('Fetch aborted by user');
        } else {
          console.error(error);
        }
      });
  }

  /**
   * @typedef {Object} NewProduct
   * @property {string} id
   * @property {string} url
   */

  /**
   * Re-renders the variant picker.
   * @param {Document} newHtml - The new HTML.
   * @returns {NewProduct | undefined} Information about the new product if it has changed, otherwise undefined.
   */
  updateVariantPicker(newHtml) {
    /** @type {NewProduct | undefined} */
    let newProduct;

    const newVariantPickerSource = newHtml.querySelector(this.tagName.toLowerCase());

    if (!newVariantPickerSource) {
      throw new Error('No new variant picker source found');
    }

    // For combined listings, the product might have changed, so update the related data attribute.
    if (newVariantPickerSource instanceof HTMLElement) {
      const newProductId = newVariantPickerSource.dataset.productId;
      const newProductUrl = newVariantPickerSource.dataset.productUrl;

      if (newProductId && newProductUrl && this.dataset.productId !== newProductId) {
        newProduct = { id: newProductId, url: newProductUrl };
      }

      this.dataset.productId = newProductId;
      this.dataset.productUrl = newProductUrl;
    }

    morph(this, newVariantPickerSource);

    // Apply swatches limit after morph
    this.#applySwatchesLimit();

    return newProduct;
  }

  /**
   * Re-renders the entire main content.
   * @param {Document} newHtml - The new HTML.
   */
  updateMain(newHtml) {
    const main = document.querySelector('main');
    const newMain = newHtml.querySelector('main');

    if (!main || !newMain) {
      throw new Error('No new main source found');
    }

    morph(main, newMain);
  }

  /**
   * Gets the selected option.
   * @returns {HTMLInputElement | HTMLOptionElement | undefined} The selected option.
   */
  get selectedOption() {
    const selectedOption = this.querySelector('select option[selected], fieldset input:checked');

    if (!(selectedOption instanceof HTMLInputElement || selectedOption instanceof HTMLOptionElement)) {
      return undefined;
    }

    return selectedOption;
  }

  /**
   * Gets the selected option ID.
   * @returns {string | undefined} The selected option ID.
   */
  get selectedOptionId() {
    const { selectedOption } = this;
    if (!selectedOption) return undefined;
    const { optionValueId } = selectedOption.dataset;

    if (!optionValueId) {
      throw new Error('No option value ID found');
    }

    return optionValueId;
  }

  /**
   * Gets the selected options values.
   * @returns {string[]} The selected options values.
   */
  get selectedOptionsValues() {
    /** @type HTMLElement[] */
    const selectedOptions = Array.from(this.querySelectorAll('select option[selected], fieldset input:checked'));

    return selectedOptions.map((option) => {
      const { optionValueId } = option.dataset;

      if (!optionValueId) throw new Error('No option value ID found');

      return optionValueId;
    });
  }

  /**
   * Apply swatches limit after variant update to ensure only the specified number
   * of swatches are visible and the "more" button is properly displayed.
   */
  #applySwatchesLimit() {
    const swatchesLists = this.querySelectorAll('.swatches-list');

    swatchesLists.forEach((swatchesList) => {
      const swatches = swatchesList.querySelectorAll('.variant-option__swatch');
      const moreButton = swatchesList.querySelector('.variant-option__button-label--more');

      // Get limit from data attribute or default to 4
      const limit = parseInt(this.dataset.limitSwatchesShow || '4', 10);

      // Count visible swatches (excluding the more button)
      const visibleSwatches = Array.from(swatches).filter(swatch =>
        !swatch.querySelector('.variant-option__button-label--more')
      );

      if (limit <= 0) {
        // Hide all swatches and show more button when limit is 0
        visibleSwatches.forEach((swatch) => {
          if (swatch instanceof HTMLElement) {
            swatch.style.display = 'none';
          }
        });

        if (moreButton && moreButton instanceof HTMLElement) {
          const optionName = this.querySelector('legend')?.textContent?.trim() || 'options';
          const countSpan = moreButton.querySelector('.more-swatches__count');
          if (countSpan) {
            countSpan.textContent = `+${visibleSwatches.length} more ${optionName}`;
          }
          moreButton.style.display = '';
        }
        return;
      }

      if (visibleSwatches.length > limit) {
        // Hide swatches beyond the limit
        visibleSwatches.forEach((swatch, index) => {
          if (index >= limit) {
            if (swatch instanceof HTMLElement) {
              swatch.style.display = 'none';
            }
          }
        });

        // Create or show more button
        let moreButtonToUse = moreButton;
        if (!moreButtonToUse) {
          // Create more button if it doesn't exist
          moreButtonToUse = this.#createMoreButton(visibleSwatches.length - limit);
          if (moreButtonToUse) {
            swatchesList.appendChild(moreButtonToUse);
          }
        }

        if (moreButtonToUse && moreButtonToUse instanceof HTMLElement) {
          const remainingCount = visibleSwatches.length - limit;
          const optionName = this.querySelector('legend')?.textContent?.trim() || 'options';
          const countSpan = moreButtonToUse.querySelector('.more-swatches__count');
          if (countSpan) {
            countSpan.textContent = `+${remainingCount} more ${optionName}`;
          }
          moreButtonToUse.style.display = '';
        }
      } else {
        // Show all swatches and hide more button
        visibleSwatches.forEach((swatch) => {
          if (swatch instanceof HTMLElement) {
            swatch.style.display = '';
          }
        });
        if (moreButton && moreButton instanceof HTMLElement) {
          moreButton.style.display = 'none';
        }
      }
    });
  }

  /**
   * Create more button element when it doesn't exist in the HTML.
   * This happens when the server returns HTML without the "more" button
   * during variant updates.
   *
   * @param {number} remainingCount - The number of remaining swatches
   * @returns {HTMLElement | null} The created more button element
   */
  #createMoreButton(remainingCount) {
    try {
      // Get the selected variant URL from the current state
      const selectedVariantScript = this.querySelector('script[type="application/json"]');
      let selectedVariantUrl = this.dataset.productUrl;

      if (selectedVariantScript && selectedVariantScript.textContent) {
        try {
          const variantData = JSON.parse(selectedVariantScript.textContent);
          if (variantData && variantData.url) {
            selectedVariantUrl = variantData.url;
          }
        } catch (e) {
          console.warn('Could not parse variant data:', e);
        }
      }

      // If we still don't have a URL, try to get it from the current selected variant
      if (!selectedVariantUrl || selectedVariantUrl === this.dataset.productUrl) {
        const selectedInput = this.querySelector('input:checked');
        if (selectedInput && selectedInput instanceof HTMLElement && selectedInput.dataset.variantId) {
          // Construct URL with variant parameter
          const baseUrl = this.dataset.productUrl;
          const variantId = selectedInput.dataset.variantId;

          // Check if baseUrl already has query parameters
          if (baseUrl) {
            const url = new URL(baseUrl, window.location.origin);
            url.searchParams.set('variant', variantId);
            selectedVariantUrl = url.toString();
          }
        }
      }

      if (!selectedVariantUrl) return null;

      // Create the more button element
      const li = document.createElement('li');
      li.className = 'variant-option__swatch';

      const a = document.createElement('a');
      a.href = selectedVariantUrl;
      a.className = 'variant-option__button-label--more';
      a.setAttribute('aria-label', 'Show all options');

      const span = document.createElement('span');
      span.className = 'more-swatches__count';

      // Get option name from legend
      const legend = this.querySelector('legend');
      const optionName = legend?.textContent?.trim() || 'options';
      span.textContent = `+${remainingCount} more ${optionName}`;

      a.appendChild(span);
      li.appendChild(a);

      return li;
    } catch (error) {
      console.error('Error creating more button:', error);
      return null;
    }
  }
}

if (!customElements.get('variant-picker')) {
  customElements.define('variant-picker', VariantPicker);
}
